/* eslint-disable no-console */
// ============================================================================
// Inline Annotations — Ephemeral Hint Overlays
// ============================================================================
//
// Renders AI configuration hints as a floating HTML panel fixed to the
// bottom-right of the Node-RED viewport. Pure DOM, zero Node-RED model
// interaction — no import, no undo, no event loops.
//
// Next-node suggestions (TASK-12.9) are rendered as ghost nodes + wires on
// the canvas via Node-RED v5's built-in RED.view.setSuggestedFlow() API —
// but ONLY when the selected node has nothing connected to its output port.
// If the output port is already wired, the existing text panel is used as
// a fallback.
//
// Ref: resources/hintsSidebar.js (emits nr-assistant:hints-ready)
// Ref: resources/nextNodeAgent.js (emits nr-assistant:next-node-ready)
// Ref: https://github.com/node-red/node-red/blob/main/packages/node_modules/%40node-red/editor-client/src/js/ui/view.js (setSuggestedFlow)
//
// Examples:
//   const ann = new InlineAnnotations()
//   ann.init({ RED })
//   // hintsSidebar emits 'nr-assistant:hints-ready' → panel appears
//   // nextNodeAgent emits 'nr-assistant:next-node-ready' → ghost nodes on canvas (if output empty)

/** @type {string} Synthetic event carrying resolved hints to the renderer. */
export const HINTS_READY_EVENT = 'nr-assistant:hints-ready'

/** @type {string} Synthetic event carrying next-node suggestions. */
export const NEXT_NODE_READY_EVENT = 'nr-assistant:next-node-ready'

/** @type {string} CSS class for the hint overlay panel. */
const PANEL_CLASS = 'nr-assistant-inline-hint-panel'

/** @type {number} Soft cap on simultaneous hints (matches hint-generator prompt cap). */
const MAX_HINTS = 4

export class InlineAnnotations {
    /** @type {import('node-red').NodeRedInstance|null} */
    RED = null

    /**
     * The currently-displayed hint panel DOM element, or null.
     * @type {HTMLElement|null}
     */
    _panel = null

    /**
     * The node id the currently-displayed hints describe.
     * @type {string|null}
     */
    _activeTargetId = null

    /** @type {string[]} Current config hints (set by render, used by _renderPanel). */
    _hints = []

    /** @type {{ type: string, reason: string, wireFromPort?: number }[]} Next-node suggestions. */
    _nextNodes = []

    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * @param {Object} params
     * @param {import('node-red').NodeRedInstance} params.RED
     * @param {Object} [params.hintsSidebar] - Accepted for symmetry but unused.
     * @returns {void}
     */
    init ({ RED, hintsSidebar = null } = {}) {
        this.RED = RED
        void hintsSidebar

        this._registerEventListeners()
        console.log('[nr-assistant:inline] inline annotations initialised (panel mode)')
    }

    // ── Event wiring ────────────────────────────────────────────────────────

    _registerEventListeners () {
        this.RED.events?.on?.(HINTS_READY_EVENT, (payload) => {
            this.render(payload)
        })

        // Next-node suggestions — distinct from config hints, rendered
        // with a "🔌" prefix and node-type labels (TASK-12.9).
        this.RED.events?.on?.(NEXT_NODE_READY_EVENT, (payload) => {
            this.renderNextNode(payload)
        })

        // Selection changed → remove the panel, UNLESS the selection matches
        // the node we just rendered hints for (cache hit case — hintsSidebar
        // fires its 'view:selection-changed' listener first, which emits
        // hints-ready and creates the panel; our listener runs second and
        // should not undo that work).
        this.RED.events?.on?.('view:selection-changed', (event) => {
            const selectedId = event?.nodes?.[0]?.id
            if (selectedId && selectedId === this._activeTargetId) return
            this.pruneAll()
        })

        this.RED.events?.on?.('flows:loaded', () => {
            this._panel = null
            this._activeTargetId = null
            this._clearGhostFlow()
        })
    }

    // ── Render ──────────────────────────────────────────────────────────────

    /**
     * Show config hints. Stores the hints and (re)builds the unified panel.
     * If next-node suggestions have already arrived, they appear below.
     *
     * @param {Object} params
     * @param {Object} params.node
     * @param {string[]} params.hints
     * @returns {void}
     */
    render ({ node, hints } = {}) {
        if (!node?.id) return

        // Different node → reset the other section too.
        if (this._activeTargetId && this._activeTargetId !== node.id) {
            this._nextNodes = []
        }

        this._hints = Array.isArray(hints) ? hints : []
        this._activeTargetId = node.id
        this._renderPanel()
    }

    // ── Next-node suggestions (TASK-12.9) ───────────────────────────────────

    /**
     * Render next-node suggestions as ghost nodes + wires on the canvas,
     * but ONLY when the selected node has nothing connected to its output
     * port. If the output is already wired, fall back to the text panel.
     *
     * Uses Node-RED v5's built-in setSuggestedFlow() API which handles:
     *   - Ghost node rendering (reduced opacity, dashed outline)
     *   - Ghost wire from source port to ghost node
     *   - Tab → apply, ↑/↓ → cycle, anything else → dismiss
     *   - Pagination badges ("1 / N")
     *
     * Ref: view.js setSuggestedFlow() (line ~7477 in @node-red/editor-client)
     *
     * @param {Object} params
     * @param {Object} params.node - The selected (source) node.
     * @param {{ type: string, reason: string, wireFromPort?: number }[]} params.suggestions
     * @returns {void}
     */
    renderNextNode ({ node, suggestions } = {}) {
        if (!node?.id) return

        // Different node → reset the other section too.
        if (this._activeTargetId && this._activeTargetId !== node.id) {
            this._hints = []
            // Also clear any ghost flow for the previous node.
            this._clearGhostFlow()
        }

        this._nextNodes = Array.isArray(suggestions) ? suggestions : []
        this._activeTargetId = node.id

        // ── Guard: only render ghost if no output port is already wired ──
        // If the node already feeds into something, a ghost suggestion
        // would be visually confusing — fall back to the text panel.
        if (this._hasDownstreamConnections(node)) {
            console.log('[nr-assistant:inline] output port wired — falling back to text panel', {
                nodeId: node.id
            })
            this._renderPanel()
            return
        }

        // ── Render ghost nodes on canvas via setSuggestedFlow ───────────
        this._renderGhostFlow(node)
    }

    /**
     * Check whether the given node has any outgoing wires on any output port.
     *
     * Node-RED stores wires as node.wires[portIndex] = [targetId, ...].
     * If any port has a non-empty wire list, the node is already connected
     * downstream.
     *
     * @param {Object} node
     * @returns {boolean}
     */
    _hasDownstreamConnections (node) {
        if (!Array.isArray(node.wires)) return false
        // Check every output port — if any port has at least one target, the
        // node is already wired downstream.
        for (const wireList of node.wires) {
            if (Array.isArray(wireList) && wireList.length > 0) {
                return true
            }
        }
        return false
    }

    /**
     * Build and render ghost nodes + wires via RED.view.setSuggestedFlow().
     *
     * Top suggestions become individual pages (↑/↓ cycles through them),
     * all wired from the selected node's recommended output port.
     *
     * After setSuggestedFlow renders synchronously, we reach into the DOM
     * and replace each ghost node's label with the suggestion's `reason`
     * text — so the user sees WHY that node is recommended, not just its
     * type name. Node-RED's suggestion pipeline intentionally skips the
     * `name` property override (view.js line ~7583: d !== 'name'), so DOM
     * manipulation is the only way to inject a custom label at ghost time.
     *
     * @param {Object} node - The source node the ghost should wire from.
     * @returns {void}
     */
    _renderGhostFlow (node) {
        if (!this._nextNodes.length) return

        // Ensure RED.view.setSuggestedFlow is available (Node-RED v5+).
        if (typeof this.RED?.view?.setSuggestedFlow !== 'function') {
            console.log('[nr-assistant:inline] setSuggestedFlow not available — falling back to panel')
            this._renderPanel()
            return
        }

        // Determine which port to wire from. Wire from the first empty port
        // (the render guard already ensures at least one port is empty).
        const sourcePort = this._resolveSourcePort(node)

        // ── Find a clear spot on the canvas ────────────────────────────
        // Default position (same as position:'relative'): right of source
        // with 3× grid gap. If that spot overlaps an existing node, step
        // downward until we find clear space.
        const existingNodes = this._collectExistingNodes()
        const gridSize = this.RED.view?.gridSize?.() || 20
        const defaultX = node.x + (node.w || 120) + (3 * gridSize)
        const defaultY = node.y
        const ghostW = 120 // initial estimate; rects resized later if needed
        const ghostH = 30
        const { x, y } = this._findClearSpot(defaultX, defaultY, ghostW, ghostH, existingNodes, gridSize)

        // Use absolute x,y — omit position:'relative' so setSuggestedFlow
        // places the ghost exactly where we tell it. The source wire still
        // connects because we pass `source` and `sourcePort`.
        const suggestionPages = this._nextNodes.slice(0, MAX_HINTS).map(s => ([{
            type: s.type,
            x,
            y,
            // name is skipped during ghost rendering (view.js d !== 'name'
            // guard in refreshSuggestedFlow) — we handle the label via DOM.
            // When the suggestion is accepted (Tab), applySuggestedFlow passes
            // the config to importNodes which DOES apply name to the real node.
            name: s.reason
        }]))

        this.RED.view.setSuggestedFlow({
            nodes: suggestionPages,
            source: node,
            sourcePort,
            clickToApply: true
        })

        // ── Label ghost nodes with the reason text ─────────────────────
        // Initial label application after double-rAF (allows layout).
        // Then start a recurring rAF poll to keep labels correct through
        // ↑/↓ arrow-key cycling — Node-RED's refreshSuggestedFlow()
        // re-renders ghost nodes via D3, resetting labels to type names.
        const schedule = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (fn) => setTimeout(fn, 0)
        schedule(() => {
            schedule(() => {
                this._labelGhostNodes()
                this._startLabelPoll()
            })
        })

        console.log('[nr-assistant:inline] rendered ghost flow', {
            targetNodeId: node.id,
            nodeType: node.type,
            pageCount: suggestionPages.length,
            sourcePort
        })
    }

    /**
     * Start a recurring rAF loop that keeps ghost labels in sync.
     *
     * When the user presses ↑/↓ to cycle suggestion pages, Node-RED's
     * refreshSuggestedFlow() calls redraw() which re-renders the ghost
     * node SVG from scratch — resetting the label to the type name.
     * This poll re-applies the reason text on every frame while the ghost
     * is active, so the label survives cycling.
     *
     * @returns {void}
     */
    _startLabelPoll () {
        this._stopLabelPoll()
        const poll = () => {
            if (!this._activeTargetId || !this._nextNodes.length) return
            this._labelGhostNodes()
            this._labelPollRaf = requestAnimationFrame(poll)
        }
        this._labelPollRaf = requestAnimationFrame(poll)
    }

    /**
     * Cancel the label-maintenance poll loop.
     *
     * @returns {void}
     */
    _stopLabelPoll () {
        if (this._labelPollRaf) {
            cancelAnimationFrame(this._labelPollRaf)
            this._labelPollRaf = null
        }
    }

    /**
     * Find all ghost nodes in the canvas SVG and replace their labels with
     * the corresponding suggestion reason text.
     *
     * Ghost nodes are SVG <g> elements with class `red-ui-flow-node-ghost`.
     * Their label text lives in `<text class="red-ui-flow-node-label-text">`
     * children, one per line. We replace the first line with the reason.
     *
     * If a reason is empty, the ghost keeps its default type label.
     *
     * @returns {void}
     */
    _labelGhostNodes () {
        const ghostEls = document.querySelectorAll('.red-ui-flow-node-ghost')

        ghostEls.forEach((ghostEl) => {
            // ── Always reveal the label ────────────────────────────────
            this._revealGhostLabel(ghostEl)

            const labelTexts = ghostEl.querySelectorAll('.red-ui-flow-node-label-text')
            if (labelTexts.length === 0) return

            const labelText = labelTexts[0]

            // ── Match ghost to suggestion by type name ─────────────────
            // The ghost's current label is the type name (e.g. "function").
            // Match it against our suggestions to find the correct reason,
            // regardless of which page the user cycled to via ↑/↓.
            // This avoids the DOM-index mismatch when cycling pages.
            const currentLabel = (labelText.textContent || '').trim()
            if (currentLabel === 'debug') return // self-explanatory

            const match = this._nextNodes.find(s => s.type === currentLabel)
            if (!match?.reason) return

            this._finishLabelReplace(labelText, match.reason, ghostEl)
        })
    }

    /**
     * Shared label replacement: measure old width, set reason text,
     * measure new width, resize rects if needed.
     *
     * @param {Element} labelText
     * @param {string} reason
     * @param {Element} ghostEl
     * @returns {void}
     */
    _finishLabelReplace (labelText, reason, ghostEl) {
        // ── Only act if the label actually changed ──────────────────
        const oldText = labelText.textContent || ''
        if (oldText === reason) return

        // ── Measure before/after text width ─────────────────────────
        const oldWidth = this._measureTextWidth(oldText)

        labelText.textContent = reason

        const newWidth = this._measureTextWidth(reason)
        // Safety margin: 25% extra to account for font rendering
        // differences between canvas and SVG, and Node-RED's internal
        // label positioning offsets.
        const safetyFactor = 1.25
        const extraWidth = (newWidth * safetyFactor) - oldWidth

        // ── Resize node rects if text grew ──────────────────────────
        if (extraWidth > 0) {
            this._resizeGhostNode(ghostEl, extraWidth)
        }
    }

    /**
     * Force the ghost node's label group to be visible by removing
     * the `hide` CSS class. Node-RED can hide labels for certain node
     * configurations (e.g. function nodes with label toggled off).
     *
     * @param {Element} ghostEl - The ghost <g> element.
     * @returns {void}
     */
    _revealGhostLabel (ghostEl) {
        // The label group is a <g> child with class "red-ui-flow-node-label".
        // If it also has class "hide", the label text is invisible.
        // SVG elements support classList in all modern browsers, but test
        // mocks may not — guard defensively.
        const labelGroup = ghostEl.querySelector('.red-ui-flow-node-label')
        if (labelGroup?.classList?.remove) {
            labelGroup.classList.remove('hide')
        }
    }

    /**
     * Grow the ghost node's rect elements to accommodate wider label text.
     *
     * DOM structure inside a ghost node <g> (from view.js redrawNode):
     *   1. <rect class="red-ui-flow-node"> — main body
     *   2. <rect class="red-ui-flow-node-highlight"> — halo (6px wider)
     *
     * We grow the rects to the right only (no leftward shift). The
     * ghost group stays where setSuggestedFlow placed it — well to the
     * right of the source node. Shifting left would bring text into
     * overlap with the source, so we let the ghost extend rightwards
     * instead, where there's nothing to collide with.
     *
     * @param {Element} ghostEl - The ghost node's <g> SVG element.
     * @param {number} extraWidth - Additional width needed in px.
     * @returns {void}
     */
    _resizeGhostNode (ghostEl, extraWidth) {
        // ── Main body rect ─────────────────────────────────────────────
        const mainRect = ghostEl.querySelector('rect.red-ui-flow-node')
        if (mainRect) {
            const curW = parseFloat(mainRect.getAttribute('width')) || 100
            mainRect.setAttribute('width', curW + extraWidth)
        }

        // ── Halo rect ──────────────────────────────────────────────────
        const haloRect = ghostEl.querySelector('rect.red-ui-flow-node-highlight')
        if (haloRect) {
            const curHaloW = parseFloat(haloRect.getAttribute('width')) || 106
            haloRect.setAttribute('width', curHaloW + extraWidth)
        }
    }

    /**
     * Resolve which output port to wire the ghost from.
     *
     * Uses the suggestion's wireFromPort if provided and available (empty),
     * otherwise picks the first output port that has nothing connected.
     *
     * @param {Object} node
     * @returns {number} 0-based output port index.
     */
    _resolveSourcePort (node) {
        // Use the first suggestion's wireFromPort if it's valid and empty.
        const preferredPort = this._nextNodes[0]?.wireFromPort ?? 0
        if (
            Array.isArray(node.wires) &&
            preferredPort < node.wires.length &&
            (!Array.isArray(node.wires[preferredPort]) || node.wires[preferredPort].length === 0)
        ) {
            return preferredPort
        }

        // Fallback: find the first empty port.
        if (Array.isArray(node.wires)) {
            for (let i = 0; i < node.wires.length; i++) {
                if (!Array.isArray(node.wires[i]) || node.wires[i].length === 0) {
                    return i
                }
            }
        }

        // Last resort — port 0. The guard in renderNextNode already ensures
        // we only get here when at least one port is empty.
        return 0
    }

    /**
     * Measure text width in pixels using a canvas 2D context.
     *
     * Canvas measureText() works without the element being in the DOM,
     * so it's a reliable fallback when getComputedTextLength() returns
     * 0 (e.g. before the browser has laid out newly-inserted SVG).
     *
     * Uses 12px sans-serif which matches Node-RED's default label font.
     * Ref: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/measureText
     *
     * @param {string} text
     * @returns {number} Approximate width in pixels.
     */
    _measureTextWidth (text) {
        if (!text) return 0
        // Reuse a single off-screen canvas to avoid creating one per call.
        if (!InlineAnnotations._textCanvas) {
            const canvas = document.createElement('canvas')
            InlineAnnotations._textCanvas = canvas.getContext('2d')
            // Node-RED v5 uses system-ui font stack at ~12px for node labels.
            // Ref: packages/node_modules/@node-red/editor-client/src/scss/flow.scss
            InlineAnnotations._textCanvas.font = '12px system-ui, -apple-system, sans-serif'
        }
        return InlineAnnotations._textCanvas.measureText(text).width
    }

    /**
     * Collect all non-ghost nodes currently on the active canvas tab
     * as simple bounding boxes for overlap detection.
     *
     * Each entry has { x, y, w, h } in canvas coordinates.
     * Excludes the ghost layer's own nodes by filtering __ghost.
     *
     * @returns {{ x: number, y: number, w: number, h: number }[]}
     */
    _collectExistingNodes () {
        const nodes = []
        if (typeof this.RED?.nodes?.eachNode === 'function') {
            this.RED.nodes.eachNode((n) => {
                // Skip ghost nodes (from a previous suggestion cycle)
                // and config nodes (they don't live on the canvas).
                if (n.__ghost) return
                if (n._def?.category === 'config' && !n.z) return
                nodes.push({
                    x: n.x - (n.w / 2),
                    y: n.y - (n.h / 2),
                    w: n.w,
                    h: n.h
                })
            })
        }
        return nodes
    }

    /**
     * Find a position for the ghost node that doesn't overlap any
     * existing node.
     *
     * Starts at the default position (right of source node). If that
     * overlaps, steps downward by ghostH + gridSize until a clear spot
     * is found or a maximum step limit is reached.
     *
     * Two boxes overlap when they intersect on both axes. We add a
     * small buffer (half grid) so the ghost doesn't sit flush against
     * a neighbour.
     *
     * @param {number} startX - Default x position.
     * @param {number} startY - Default y position.
     * @param {number} ghostW - Estimated ghost node width.
     * @param {number} ghostH - Estimated ghost node height.
     * @param {{ x: number, y: number, w: number, h: number }[]} existingNodes
     * @param {number} gridSize - Grid size for step increments.
     * @returns {{ x: number, y: number }}
     */
    _findClearSpot (startX, startY, ghostW, ghostH, existingNodes, gridSize) {
        const MAX_STEPS = 10
        // Half-grid buffer so the ghost doesn't sit flush against a neighbour.
        const buffer = gridSize / 2

        for (let step = 0; step < MAX_STEPS; step++) {
            const candidateX = startX
            const candidateY = startY + step * (ghostH + gridSize)

            const candidateBox = {
                x: candidateX - buffer,
                y: candidateY - buffer,
                w: ghostW + buffer * 2,
                h: ghostH + buffer * 2
            }

            const overlaps = existingNodes.some(n =>
                candidateBox.x < n.x + n.w &&
                candidateBox.x + candidateBox.w > n.x &&
                candidateBox.y < n.y + n.h &&
                candidateBox.y + candidateBox.h > n.y
            )

            if (!overlaps) {
                return { x: candidateX, y: candidateY }
            }
        }

        // If no clear spot found after max steps, return the last position
        // tried — better to show something than nothing.
        return { x: startX, y: startY + (MAX_STEPS - 1) * (ghostH + gridSize) }
    }

    /**
     * Clear any active ghost flow rendered via setSuggestedFlow.
     * Passing null is the canonical way to dismiss suggestions in NRv5.
     *
     * @returns {void}
     */
    _clearGhostFlow () {
        if (typeof this.RED?.view?.setSuggestedFlow === 'function') {
            this.RED.view.setSuggestedFlow(null)
        }
    }

    // ── Unified panel builder ───────────────────────────────────────────────

    /**
     * Compose the floating panel from whatever sections are available.
     * Handles both config hints (💡) and next-node suggestions (🔌) in a
     * single panel so they coexist without trampling each other.
     *
     * @returns {void}
     */
    _renderPanel () {
        // Remove old panel if any.
        if (this._panel) {
            this._panel.remove()
            this._panel = null
        }

        const hasHints = this._hints.length > 0
        const hasNext = this._nextNodes.length > 0
        if (!hasHints && !hasNext) return

        // ── Create the panel ────────────────────────────────────────────
        const panel = document.createElement('div')
        panel.className = PANEL_CLASS

        // Build config hints section (appears first).
        let html = ''
        if (hasHints) {
            const cappedHints = this._hints.slice(0, MAX_HINTS)
            const linesHtml = cappedHints.map(hint =>
                `<div class="nr-assistant-inline-hint-line">💡 ${this._escapeHtml(hint)}</div>`
            ).join('')
            html += `<div class="nr-assistant-inline-hint-header">Suggestions</div>
<div class="nr-assistant-inline-hint-body">${linesHtml}</div>`
        }

        // Build next-node section (appears below hints, with a separator).
        if (hasNext) {
            if (hasHints) {
                html += '<hr style="border:0;border-top:1px solid rgba(255,255,255,0.1);margin:8px 0;">'
            }
            const cappedNext = this._nextNodes.slice(0, MAX_HINTS)
            const linesHtml = cappedNext.map(s =>
                `<div class="nr-assistant-inline-hint-line">🔌 Add a <code>${this._escapeHtml(s.type)}</code> — ${this._escapeHtml(s.reason || '')}</div>`
            ).join('')
            html += `<div class="nr-assistant-inline-hint-header">Next Nodes</div>
<div class="nr-assistant-inline-hint-body">${linesHtml}</div>`
        }

        panel.innerHTML = html

        const container = document.querySelector('#red-ui-workspace-chart')?.parentElement ||
                          document.querySelector('#red-ui-main-container') ||
                          document.body
        if (container && !container.style.position) {
            container.style.position = 'relative'
        }
        container.appendChild(panel)

        this._panel = panel

        const section = hasHints && hasNext ? 'both' : hasHints ? 'hints' : 'next-node'
        console.log('[nr-assistant:inline] rendered panel', {
            targetNodeId: this._activeTargetId,
            section,
            hintCount: this._hints.length,
            nextCount: this._nextNodes.length
        })
    }

    _escapeHtml (text) {
        const div = document.createElement('div')
        div.textContent = text
        return div.innerHTML
    }

    // ── Prune ───────────────────────────────────────────────────────────────

    pruneAll () {
        if (this._panel) {
            this._panel.remove()
            this._panel = null
        }
        // Also clear any ghost flow on the canvas.
        this._stopLabelPoll()
        this._clearGhostFlow()
        this._activeTargetId = null
        this._hints = []
        this._nextNodes = []
    }

    // ── Introspection ───────────────────────────────────────────────────────

    get overlayCount () {
        return this._panel ? 1 : 0
    }

    get activeTargetId () {
        return this._activeTargetId
    }
}

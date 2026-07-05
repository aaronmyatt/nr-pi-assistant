/* eslint-disable no-console */
// ============================================================================
// Inline Annotations — Ephemeral Hint Overlays
// ============================================================================
//
// Renders AI configuration hints as a floating HTML panel fixed to the
// bottom-right of the Node-RED viewport. Pure DOM, zero Node-RED model
// interaction — no import, no undo, no event loops.
//
// Ref: resources/hintsSidebar.js (emits nr-assistant:hints-ready)
//
// Examples:
//   const ann = new InlineAnnotations()
//   ann.init({ RED })
//   // hintsSidebar emits 'nr-assistant:hints-ready' → panel appears

/** @type {string} Synthetic event carrying resolved hints to the renderer. */
export const HINTS_READY_EVENT = 'nr-assistant:hints-ready'

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

        // Selection changed → remove the panel.
        this.RED.events?.on?.('view:selection-changed', () => {
            this.pruneAll()
        })

        this.RED.events?.on?.('flows:loaded', () => {
            this._panel = null
            this._activeTargetId = null
        })
    }

    // ── Render ──────────────────────────────────────────────────────────────

    /**
     * Show a floating hint panel at the bottom-right of the viewport.
     *
     * @param {Object} params
     * @param {Object} params.node - The target node the hints describe.
     * @param {string[]} params.hints - Array of hint strings.
     * @returns {void}
     */
    render ({ node, hints } = {}) {
        this.pruneAll()

        if (!node?.id) return
        if (!Array.isArray(hints) || hints.length === 0) return

        const capped = hints.slice(0, MAX_HINTS)

        // ── Create the panel ────────────────────────────────────────────
        const panel = document.createElement('div')
        panel.className = PANEL_CLASS

        // Build the hint lines.
        const linesHtml = capped.map(hint =>
            `<div class="nr-assistant-inline-hint-line">💡 ${this._escapeHtml(hint)}</div>`
        ).join('')

        panel.innerHTML = `
            <div class="nr-assistant-inline-hint-header">Suggestions</div>
            <div class="nr-assistant-inline-hint-body">${linesHtml}</div>
        `

        // Append to the workspace container so the panel respects canvas
        // bounds (doesn't overlap the sidebar). Set position: relative on
        // the container so our position: absolute panel anchors correctly.
        const container = document.querySelector('#red-ui-workspace-chart')?.parentElement ||
                          document.querySelector('#red-ui-main-container') ||
                          document.body
        if (container && !container.style.position) {
            container.style.position = 'relative'
        }
        container.appendChild(panel)

        this._panel = panel
        this._activeTargetId = node.id

        console.log('[nr-assistant:inline] rendered hint panel', {
            targetNodeId: node.id,
            count: capped.length
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
        this._activeTargetId = null
    }

    // ── Introspection ───────────────────────────────────────────────────────

    get overlayCount () {
        return this._panel ? 1 : 0
    }

    get activeTargetId () {
        return this._activeTargetId
    }
}

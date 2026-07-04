/* eslint-disable no-console */
// ============================================================================
// AutoLabeler — Opportunistic Node Label Generation
// ============================================================================
//
// Watches editor events and generates human-readable workspace names for nodes
// that are not yet explicitly named by the user. The strategy is:
// 1. Auto-label immediately on nodes:add (from palette/suggestion sources only).
// 2. Refine existing auto-labels when links:add provides new wiring context.
// 3. Regenerate labels on nodes:change, BUT only when the node's meaningful
//    properties have actually changed — we fingerprint the config and skip
//    re-labeling when the fingerprint matches the last auto-labeled state.
//
// The fingerprint guard is what prevents spurious re-labeling on open/move/
// select events. Without it, every editor interaction would trigger
// unnecessary label generation.
//
// Ownership model:
// - When we auto-apply a label, we record the node→label mapping.
// - If the node's current name still matches our recorded label, we know it's
//   "ours" and safe to overwrite with an improved suggestion.
// - If the user has changed the name since we last touched it, we treat it as
//   user-authored and do NOT auto-apply. We may still surface a suggestion in
//   the hints panel.
//
// Ref: https://nodered.org/docs/developing-flows/documenting-flows

import { getNodeInstanceContext } from './nodeContext.js'

/** @type {number} Max LLM refinement attempts per node per session. */
const MAX_REFINEMENT_ATTEMPTS = 5

/** @type {number} Debounce before an LLM refinement fires after wiring changes. */
const REFINE_DEBOUNCE_MS = 1500

/** @type {number} Debounce window for nodes:change — we wait for a quiet period so rapid config tweaks don't spam the backend. */
const CHANGE_DEBOUNCE_MS = 2000

export class AutoLabeler {
    /** @type {import('node-red').NodeRedInstance|null} */
    RED = null
    hintsSidebar = null

    // ── Configurable timings (overridable for tests) ─────────────────

    /** @type {number} Debounce for LLM refinement after wiring changes (ms). @default 1500 */
    _refineDebounceMs = REFINE_DEBOUNCE_MS

    /** @type {number} Debounce for nodes:change re-labeling (ms). @default 2000 */
    _changeDebounceMs = CHANGE_DEBOUNCE_MS

    /** @type {Map<string, string>} nodeId → last auto-applied label */
    _autoLabels = new Map()

    /** @type {Map<string, string>} nodeId → config fingerprint at last auto-label */
    _lastFingerprints = new Map()

    /** @type {Map<string, {timer: number|null, attempts: number}>} pending LLM refinement state per node */
    _pendingRefinements = new Map()

    /** @type {Map<string, number|null>} debounce timers for nodes:change events */
    _changeTimers = new Map()

    /** @type {boolean} Suppress refinement until flows have loaded */
    _loaded = false

    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * @param {Object} params
     * @param {import('node-red').NodeRedInstance} params.RED
     * @param {Object} [params.hintsSidebar]
     * @param {number} [params.refineDebounceMs] - Override LLM refinement debounce (used in tests).
     * @param {number} [params.changeDebounceMs] - Override nodes:change debounce (used in tests).
     * @returns {void}
     */
    init ({ RED, hintsSidebar = null, refineDebounceMs, changeDebounceMs } = {}) {
        this.RED = RED
        this.hintsSidebar = hintsSidebar
        if (typeof refineDebounceMs === 'number') this._refineDebounceMs = refineDebounceMs
        if (typeof changeDebounceMs === 'number') this._changeDebounceMs = changeDebounceMs
        this._registerEventListeners()
        console.log('[nr-assistant:labels] auto-labeler initialised')
    }

    // ── Event wiring ────────────────────────────────────────────────────────

    _registerEventListeners () {
        this.RED.events?.on?.('nodes:add', (node, opts) => {
            // Only auto-label when the node comes from the palette or a
            // suggestion, not during undo/redo or flow import.
            const source = opts?.source
            if (source && source !== 'palette' && source !== 'typeSearch' && source !== 'suggestion') {
                return
            }
            if (!node?.id || !node?.type) return
            this._handleEligibleNode(node, { trigger: 'add' })
        })

        this.RED.events?.on?.('nodes:change', (node) => {
            if (!node?.id || !node?.type) return
            this._debounceChange(node)
        })

        this.RED.events?.on?.('links:add', (link) => {
            // When new wiring context arrives, our existing labels may improve.
            // We only refine labels we already own (auto-generated).
            // Skip if flows haven't loaded yet — the initial link burst on
            // page load is just rehydrating existing connections, not new
            // user intent.
            if (!this._loaded) return
            const touchedIds = [link?.source?.id, link?.target?.id].filter(Boolean)
            for (const nodeId of touchedIds) {
                if (!this._autoLabels.has(nodeId)) continue
                this._queueRefinement(nodeId)
            }
        })

        this.RED.events?.on?.('flows:loaded', () => {
            console.log('[nr-assistant:labels] flows loaded — refinement enabled')
            this._loaded = true
        })
    }

    // ── Core logic ──────────────────────────────────────────────────────────

    /**
     * Decide whether to auto-apply or queue a suggestion for a node.
     *
     * @param {Object} node
     * @param {Object} [opts]
     * @param {string} [opts.trigger]
     * @returns {void}
     */
    _handleEligibleNode (node, { trigger } = {}) {
        const currentName = (node.name || '').trim()
        const lastAuto = this._autoLabels.get(node.id)

        // Build a cheap label now — always fast, always local.
        const immediateLabel = this._buildCheapLabel(node)

        if (!currentName) {
            // Blank name is always safe to fill.
            this._setNodeLabel(node.id, immediateLabel)
            return
        }

        // If the current name matches what we last set, we can safely replace
        // it with an improved label (e.g. after wiring changed).
        if (lastAuto && currentName === lastAuto) {
            // Only update if the new label is different enough to be worth it.
            if (immediateLabel !== lastAuto) {
                this._setNodeLabel(node.id, immediateLabel)
            }
            return
        }

        // User-authored name — never auto-apply. Optionally queue a refinement
        // to surface as a suggestion in the hints panel later.
        this._queueRefinement(node.id)
    }

    /**
     * Build a fast, deterministic heuristic label.
     *
     * @param {Object} node
     * @returns {string}
     */
    _buildCheapLabel (node) {
        const type = node?.type
        if (type === 'function') return 'Transform message'
        if (type === 'change') return 'Change message'
        if (type === 'switch') return 'Route message'
        if (type === 'inject') return 'Inject trigger'
        if (type === 'http request') return 'Fetch HTTP resource'
        if (type === 'http in') return 'Handle HTTP request'
        if (type === 'http response') return 'Send HTTP response'
        if (type === 'mqtt in') return 'Receive MQTT message'
        if (type === 'mqtt out') return 'Publish MQTT message'
        if (type === 'debug') return 'Debug output'
        if (type === 'template') return 'Render template'
        if (type === 'delay') return 'Delay message'
        if (type === 'split') return 'Split payload'
        if (type === 'join') return 'Join messages'
        if (type === 'comment') return 'Flow note'
        return node?.type || 'Unnamed node'
    }

    /**
     * Apply a label and record ownership.
     *
     * @param {string} nodeId
     * @param {string} label
     * @returns {void}
     */
    _setNodeLabel (nodeId, label) {
        const node = this.RED?.nodes?.node?.(nodeId)
        if (!node) return

        node.name = label
        this._autoLabels.set(nodeId, label)
        this._lastFingerprints.set(nodeId, this._configFingerprint(node))
        this.RED.nodes?.dirty?.(true)

        console.log('[nr-assistant:labels] auto-applied label', { nodeId, label })
    }

    // ── LLM refinement path ─────────────────────────────────────────────────

    /**
     * Queue a background LLM refinement for a node.
     *
     * We cap the number of attempts per node per session to keep costs
     * predictable, and debounce to avoid spamming the API during rapid edits.
     *
     * @param {string} nodeId
     * @returns {void}
     */
    _queueRefinement (nodeId) {
        const existing = this._pendingRefinements.get(nodeId) || { timer: null, attempts: 0 }
        if (existing.attempts >= MAX_REFINEMENT_ATTEMPTS) {
            return
        }
        if (existing.timer) {
            clearTimeout(existing.timer)
        }
        existing.timer = setTimeout(() => {
            existing.timer = null
            this._doRefine(nodeId)
        }, this._refineDebounceMs)
        this._pendingRefinements.set(nodeId, existing)
    }

    /**
     * Perform an LLM refinement for a specific node.
     *
     * @param {string} nodeId
     * @returns {Promise<void>}
     */
    async _doRefine (nodeId) {
        const state = this._pendingRefinements.get(nodeId)
        if (!state || state.attempts >= MAX_REFINEMENT_ATTEMPTS) return

        const node = this.RED?.nodes?.node?.(nodeId)
        if (!node?.type) return

        state.attempts += 1

        try {
            const nodeContext = getNodeInstanceContext({ RED: this.RED, node, doc: document })
            const prompt = [
                'Generate a short, descriptive workspace label for a Node-RED node.',
                `Node type: ${node.type}`,
                `Palette label: ${nodeContext?.paletteLabel || 'unknown'}`,
                `Category: ${nodeContext?.category || 'unknown'}`,
                `Current name: ${node.name || '(blank)'}`,
                nodeContext?.helpSummary ? `What it does: ${nodeContext.helpSummary}` : '',
                '',
                'Return ONLY a JSON object: { "json": "Your Label Here" }',
                "The label must be 2–5 words, start with a capital letter, and describe the node's purpose."
            ].filter(Boolean).join('\n')

            const transactionId = `auto-label-${nodeId}-${Date.now()}`

            // Use the existing JSON generation endpoint. We reuse it instead of
            // creating a dedicated labelling route because the prompt contract
            // is trivial to adapt and the backend response shape is well-tested.
            const response = await this._ajaxJson({
                prompt,
                transactionId,
                context: { type: node.type, scope: 'label' }
            })

            if (response?.json && typeof response.json === 'string') {
                const label = response.json.trim()
                if (label.length < 2 || label.length > 60) return

                // Only auto-apply if the node is still blank or still has our
                // previous auto-label. Otherwise surface the suggestion in the
                // hints sidebar for the user to accept manually.
                const currentNode = this.RED?.nodes?.node?.(nodeId)
                if (!currentNode) return

                const currentName = (currentNode.name || '').trim()
                const lastAuto = this._autoLabels.get(nodeId)

                if (!currentName || (lastAuto && currentName === lastAuto)) {
                    this._setNodeLabel(nodeId, label)
                } else if (this.hintsSidebar?.showLabelSuggestion) {
                    this.hintsSidebar.showLabelSuggestion(node, label)
                }
            }
        } catch (_error) {
            console.log('[nr-assistant:labels] LLM refinement failed', { nodeId, error: _error?.message || String(_error) })
        }
    }

    /**
     * Thin wrapper around jQuery.ajax for the JSON generation endpoint.
     *
     * @param {Object} params
     * @param {string} params.prompt
     * @param {string} params.transactionId
     * @param {Object} params.context
     * @returns {Promise<Object>}
     */
    _ajaxJson ({ prompt, transactionId, context }) {
        return new Promise((resolve, reject) => {
            if (typeof globalThis.$ === 'undefined' || typeof globalThis.$.ajax !== 'function') {
                reject(new Error('jQuery not available'))
                return
            }
            globalThis.$.ajax({
                url: 'nr-assistant/json',
                type: 'POST',
                data: JSON.stringify({ prompt, transactionId, context }),
                contentType: 'application/json',
                timeout: 15000,
                success: (reply) => {
                    resolve(reply?.data?.data || reply?.data || reply || {})
                },
                error: (jqXHR, textStatus, errorThrown) => {
                    reject(new Error(errorThrown || textStatus || 'ajax failed'))
                }
            })
        })
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    /**
     * Build a lightweight fingerprint of the node's meaningful configuration.
     *
     * We exclude irrelevant properties so that opening, moving, or selecting
     * a node does not produce a changed fingerprint. Only configuration fields
     * that would genuinely affect what the node "does" are included.
     *
     * @param {Object} node
     * @returns {string}
     */
    _configFingerprint (node) {
        const meaningful = {
            t: node.type,
            o: node.outputs,
            // Serialise all user-facing config (skip internal editor fields)
            // We deliberately exclude name so that re-labeling still fires
            // when the user edits config properties like url, method, etc.
            c: Object.keys(node)
                .filter(k => !k.startsWith('_') && k !== 'id' && k !== 'x' && k !== 'y' && k !== 'z' && k !== 'wires' && k !== 'd' && k !== 'g' && k !== 'l' && k !== 'name' && k !== 'type' && k !== 'outputs')
                .sort()
                .map(k => `${k}=${JSON.stringify(node[k])}`)
                .join(';')
        }
        return JSON.stringify(meaningful)
    }

    /**
     * Debounce change events so rapid config edits don't spam re-labeling.
     * We wait for a quiet window, then only re-label if the node's meaningful
     * configuration has actually changed since our last auto-label.
     *
     * @param {Object} node
     * @returns {void}
     */
    _debounceChange (node) {
        const existing = this._changeTimers.get(node.id)
        if (existing) clearTimeout(existing)
        this._changeTimers.set(node.id, setTimeout(() => {
            this._changeTimers.delete(node.id)
            this._handleChangeSettled(node)
        }, this._changeDebounceMs))
    }

    /**
     * Called after the debounce window closes for a changed node.
     * Only regenerates the label if the config fingerprint has meaningfully
     * changed since the last auto-label was applied.
     *
     * @param {Object} node
     * @returns {void}
     */
    _handleChangeSettled (node) {
        // Re-read the node from the store — it may have been deleted
        const freshNode = this.RED?.nodes?.node?.(node.id)
        if (!freshNode) return

        const currentName = (freshNode.name || '').trim()
        const lastAuto = this._autoLabels.get(freshNode.id)

        // Only care about nodes we own or that are blank
        const isOurs = lastAuto && currentName === lastAuto
        const isBlank = !currentName
        if (!isOurs && !isBlank) return

        // Calculate fingerprint of meaningful config fields
        const fingerprint = this._configFingerprint(freshNode)
        const storedFingerprint = this._lastFingerprints.get(freshNode.id)

        // If nothing meaningful has changed since our last label, skip
        if (fingerprint === storedFingerprint) return

        // Build a new label and apply
        const label = this._buildCheapLabel(freshNode)
        this._setNodeLabel(freshNode.id, label)
    }
}

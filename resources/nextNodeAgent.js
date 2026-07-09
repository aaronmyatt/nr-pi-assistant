// ============================================================================
// Next-Node Agent — LLM-powered next-node recommendations
// ============================================================================
//
// On selection change, this agent asks the LLM what node(s) should be wired
// next. Results are rendered through the inline annotation panel (TASK-12.6).
//
// The existing heuristic tier-0 in completions.html (join-after-split, etc.)
// STAYS and fires instantly. This LLM agent layers on top as tier-1 — both
// results can appear simultaneously in the panel.
//
// Architecture:
//   view:selection-changed → nextNodeAgent.request() → scheduler.acquire()
//   → AJAX nr-assistant/next-node → emit 'nr-assistant:next-node-ready'
//   → inlineAnnotations.renderNextNode() → panel
//
// Ref: resources/hintsSidebar.js (pattern for scheduler-integrated LLM agent)
// Ref: resources/dagSerializer.js (canonical DAG context)
// Ref: resources/inlineAnnotations.js (renderer)
// Ref: lib/ai/prompts/next-node.md (system prompt)
//
// Examples:
//   const agent = new NextNodeAgent()
//   agent.init({ RED, scheduler })
//   // selects a node → LLM suggests downstream nodes → panel shows them

import { buildFlowContextText, buildConnectedNodesText } from './dagSerializer.js'

// ── Constants ───────────────────────────────────────────────────────────────

/** @type {string} Event emitted when next-node suggestions are ready. */
export const NEXT_NODE_READY_EVENT = 'nr-assistant:next-node-ready'

/** @type {string} Agent name registered with the shared scheduler. */
const AGENT_NAME = 'next-node'

/** @type {number} AJAX timeout in milliseconds. */
const REQUEST_TIMEOUT_MS = 15000

/** @type {number} Minimum prompt length before we bother the LLM. */
const MIN_PROMPT_LENGTH = 100

// ── NextNodeAgent ───────────────────────────────────────────────────────────

export class NextNodeAgent {
    /** @type {import('node-red').NodeRedInstance|null} */
    RED = null

    /** @type {Object|null} */
    assistantOptions = null

    /** @type {import('./agentScheduler.js').AgentScheduler|null} */
    _scheduler = null

    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * Initialize the agent and register event listeners.
     *
     * @param {Object} params
     * @param {import('node-red').NodeRedInstance} params.RED
     * @param {Object} params.assistantOptions
     * @param {import('./agentScheduler.js').AgentScheduler} params.scheduler
     * @returns {void}
     */
    init ({ RED, assistantOptions = {}, scheduler }) {
        this.RED = RED
        this.assistantOptions = assistantOptions
        this._scheduler = scheduler

        // Register with the shared scheduler so acquires are valid.
        scheduler.register(AGENT_NAME, { maxAttempts: 3 })

        this._registerEventListeners()
        console.log('[nr-assistant:next-node] initialised')
    }

    // ── Event wiring ────────────────────────────────────────────────────────

    _registerEventListeners () {
        // Fire on selection change — same trigger as hints.
        this.RED.events?.on?.('view:selection-changed', (event) => {
            const nodes = event?.nodes
            if (!nodes || nodes.length !== 1) return
            this._request(nodes[0])
        })

        // Also fire when a new link is added — the user just wired
        // something and may want to know what comes next.
        this.RED.events?.on?.('links:add', (event) => {
            const sourceNode = event?.sourceNode
            if (!sourceNode?.id) return

            // Only fire if the source node is the currently selected node.
            // We don't want to spam the LLM for every wire added anywhere.
            const selection = this.RED.nodes?.selected
            if (!selection || selection.length !== 1) return
            if (selection[0].id !== sourceNode.id) return

            this._request(sourceNode)
        })
    }

    // ── Request pipeline ────────────────────────────────────────────────────

    /**
     * Request next-node suggestions for the given node.
     *
     * @param {Object} node - The selected node.
     * @returns {void}
     */
    _request (node) {
        if (!node?.id) return
        if (!this.assistantOptions?.enabled) return

        // ── Gather context ──────────────────────────────────────────────
        const { upstream, downstream } = this._getConnectedNodes(node)

        // ── Guard: skip LLM call if any output port is already wired ────
        // There's no point suggesting a next node when the user has already
        // connected something downstream. The inlineAnnotations module will
        // also skip ghost rendering for the same reason — this guard just
        // saves the LLM round-trip.
        if (this._hasDownstreamConnections(node)) {
            console.log('[nr-assistant:next-node] output port wired — skipping LLM call', {
                nodeId: node.id
            })
            return
        }

        // ── Acquire permit from the shared scheduler ────────────────────
        const permit = this._scheduler.acquire(AGENT_NAME, {
            node,
            upstream,
            downstream
        })

        if (!permit.allowed) {
            if (permit.reason) {
                console.log(`[nr-assistant:next-node] scheduler denied`, {
                    nodeId: node.id,
                    reason: permit.reason
                })
            }
            return
        }

        // Cache hit — serve immediately.
        if (permit.fromCache) {
            console.log(`[nr-assistant:next-node] cache hit`, { nodeId: node.id })
            this._emitSuggestions(node, permit.cachedResult)
            return
        }

        // ── Build prompt ────────────────────────────────────────────────
        const prompt = this._buildPrompt(node, upstream, downstream)
        if (!prompt || prompt.length < MIN_PROMPT_LENGTH) {
            this._scheduler.release(AGENT_NAME, node.id)
            return
        }

        if (typeof globalThis.$ === 'undefined' || typeof globalThis.$.ajax !== 'function') {
            this._scheduler.release(AGENT_NAME, node.id)
            return
        }

        console.log('[nr-assistant:next-node] requesting LLM suggestions', {
            nodeId: node.id,
            nodeType: node.type,
            promptLength: prompt.length,
            txn: permit.transactionId
        })

        // ── Fire AJAX ───────────────────────────────────────────────────
        globalThis.$.ajax({
            url: 'nr-assistant/next-node',
            type: 'POST',
            data: JSON.stringify({
                prompt,
                transactionId: permit.transactionId,
                context: {
                    type: node.type,
                    scope: 'next-node'
                }
            }),
            contentType: 'application/json',
            timeout: REQUEST_TIMEOUT_MS,
            success: (reply) => {
                const data = reply?.data?.data || reply?.data
                const suggestions = this._parseResponse(data)

                // Cache the result (even if empty array — avoid re-requesting).
                this._scheduler.commit(AGENT_NAME, node.id, suggestions, {
                    node,
                    upstream,
                    downstream,
                    fingerprint: permit.fingerprint
                })

                if (suggestions.length > 0) {
                    console.log('[nr-assistant:next-node] LLM suggestions received', {
                        nodeId: node.id,
                        count: suggestions.length
                    })
                    this._emitSuggestions(node, suggestions)
                } else {
                    console.log('[nr-assistant:next-node] no suggestions returned', {
                        nodeId: node.id
                    })
                }
            },
            error: (jqXHR, textStatus, errorThrown) => {
                this._scheduler.release(AGENT_NAME, node.id)
                console.log('[nr-assistant:next-node] request failed', {
                    nodeId: node.id,
                    textStatus,
                    errorThrown: errorThrown?.message || String(errorThrown)
                })
            }
        })
    }

    // ── Prompt building ─────────────────────────────────────────────────────

    /**
     * Build the LLM prompt payload for next-node recommendations.
     *
     * Uses the canonical DAG serializer from TASK-12.7 for flow context
     * and connected-node listings. The system prompt is loaded server-side
     * based on `feature: 'method:next-node'`.
     *
     * @param {Object} node - The selected node.
     * @param {Object[]} upstream - Nodes wired into the selected node.
     * @param {Object[]} downstream - Nodes the selected node feeds into.
     * @returns {string} The full prompt string.
     */
    _buildPrompt (node, upstream, downstream) {
        const parts = []

        parts.push(`The user has selected a [${node.type}] node in their Node-RED flow.`)
        parts.push('Recommend what node(s) should be wired downstream of this node.')

        // Node description
        parts.push('')
        parts.push('SELECTED NODE:')
        parts.push(`  Type: ${node.type}`)
        if (node.name) parts.push(`  Name: "${node.name}"`)

        // Wire context
        parts.push(buildConnectedNodesText({ upstream, downstream }))

        // Include 'json' in the user prompt itself so DeepSeek's
        // response_format: json_object validation passes even if the
        // system prompt doesn't load (defence in depth).
        // Ref: https://api-docs.deepseek.com/api/create-chat-completion/
        parts.push('')
        parts.push('Return your answer as a JSON object with a top-level "suggestions" array.')

        // Full flow context (for understanding the bigger picture)
        parts.push(buildFlowContextText({
            RED: this.RED,
            selectedNode: node
        }))

        return parts.join('\n')
    }

    // ── Response parsing ────────────────────────────────────────────────────

    /**
     * Parse the LLM response into a structured suggestions array.
     *
     * Handles the contract from next-node.md:
     *   { suggestions: [{ type, reason, wireFromPort }] }
     *
     * Also handles raw string responses by attempting JSON extraction.
     *
     * @param {any} data - Raw response data from the backend.
     * @returns {{ type: string, reason: string, wireFromPort?: number }[]}
     */
    _parseResponse (data) {
        if (!data) return []

        // The backend returns { data: ... } and handlePostMethodRequest wraps
        // the result in { status: 'ok', data: result.data }. The actual LLM
        // output is in result.data, which may be a string or object.
        let parsed = data

        // Attempt JSON parse if string.
        if (typeof parsed === 'string') {
            try {
                parsed = JSON.parse(parsed)
            } catch (_e) {
                // Try to extract a JSON block from the string.
                const jsonMatch = parsed.match(/\{[\s\S]*"suggestions"[\s\S]*\}/)
                if (jsonMatch) {
                    try {
                        parsed = JSON.parse(jsonMatch[0])
                    } catch (_e2) {
                        return []
                    }
                } else {
                    return []
                }
            }
        }

        if (!parsed || typeof parsed !== 'object') return []

        const suggestions = parsed.suggestions
        if (!Array.isArray(suggestions)) return []

        // Validate each suggestion has required fields.
        return suggestions
            .filter(s => s && typeof s === 'object' && typeof s.type === 'string' && s.type.length > 0)
            .map(s => ({
                type: s.type,
                reason: s.reason || '',
                wireFromPort: typeof s.wireFromPort === 'number' ? s.wireFromPort : 0
            }))
    }

    // ── Event emission ──────────────────────────────────────────────────────

    /**
     * Emit next-node suggestions so the inline annotation renderer can
     * display them.
     *
     * @param {Object} node - The target node.
     * @param {{ type: string, reason: string, wireFromPort?: number }[]} suggestions
     * @returns {void}
     */
    _emitSuggestions (node, suggestions) {
        this.RED.events?.emit?.(NEXT_NODE_READY_EVENT, {
            node,
            suggestions
        })
    }

    // ── Graph helpers ───────────────────────────────────────────────────────

    /**
     * Check whether any output port of the node has wires connected.
     * If every output is already wired, there's no point suggesting
     * a next node — the user already has a downstream connection.
     *
     * @param {Object} node
     * @returns {boolean}
     */
    _hasDownstreamConnections (node) {
        if (!Array.isArray(node.wires)) return false
        for (const wireList of node.wires) {
            if (Array.isArray(wireList) && wireList.length > 0) {
                return true
            }
        }
        return false
    }

    /**
     * Find the nodes connected upstream and downstream of the given node.
     *
     * Mirrors the logic in hintsSidebar for consistency.
     *
     * @param {Object} node - The node to find connections for.
     * @returns {{ upstream: Object[], downstream: Object[] }}
     */
    _getConnectedNodes (node) {
        const allNodes = []
        if (typeof this.RED?.nodes?.eachNode === 'function') {
            this.RED.nodes.eachNode((n) => { allNodes.push(n) })
        } else if (typeof this.RED?.nodes?.filterNodes === 'function') {
            const result = this.RED.nodes.filterNodes({})
            if (Array.isArray(result)) allNodes.push(...result)
        }

        // Downstream: nodes that the selected node's wires point to.
        const downstreamIds = new Set()
        if (Array.isArray(node.wires)) {
            for (const w of node.wires) {
                if (Array.isArray(w)) {
                    for (const tid of w) {
                        if (tid) downstreamIds.add(tid)
                    }
                }
            }
        }
        const downstream = allNodes.filter(n => downstreamIds.has(n.id))

        // Upstream: nodes whose wires point to the selected node.
        const upstream = allNodes.filter(n => {
            if (!Array.isArray(n.wires)) return false
            return n.wires.some(w =>
                Array.isArray(w) && w.some(tid => tid === node.id)
            )
        })

        return { upstream, downstream }
    }
}

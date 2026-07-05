/* eslint-disable no-console */
// ============================================================================
// Assistant Hints Sidebar
// ============================================================================
//
// A dedicated Node-RED sidebar tab for contextual guidance about the currently
// selected node. Shows two layers of hints:
//
// 1. LOCAL HINTS (immediate) — cheap, deterministic hints from node type and
//    wiring context. Always shown, no network cost.
// 2. AI HINTS (asynchronous) — LLM-generated suggestions that understand the
//    node's actual configuration, connected nodes, and flow context. Loaded in
//    the background and cached per node+fingerprint.
//
// Why a sidebar tab:
// - Node-RED explicitly supports custom sidebar tabs for plugins.
// - The tab can stay available while edit dialogs are open via `enableOnEdit`.
// - It provides much more room than badges or toasts for readable, actionable
//   guidance.
//
// Ref: https://nodered.org/docs/api/ui/sidebar/
// Ref: https://nodered.org/docs/creating-nodes/node-html
// Ref: https://nodered.org/docs/developing-flows/documenting-flows
//
// Examples:
//   const sidebar = new AssistantHintsSidebar()
//   sidebar.init({ RED, assistantOptions: { enabled: true } })
//
//   RED.events.emit('view:selection-changed', { nodes: [RED.view.selection().nodes[0]] })

import { getNodeInstanceContext, toPromptNodeContext } from './nodeContext.js'
import {
    stripNodeCruft,
    fingerprintNode,
    getFlowName,
    buildFlowContextText,
    buildConnectedNodesText
} from './dagSerializer.js'

const TAB_ID = 'nr-assistant-hints'
const SHOW_ACTION_ID = 'flowfuse-nr-assistant:show-hints'

// ── Constants ───────────────────────────────────────────────────────────────

/** @type {number} Max attempts per node per session for AI hint requests. */
const MAX_AI_HINT_ATTEMPTS = 3

/** @type {number} Timeout for each individual AI hint AJAX request. */
const AI_HINT_TIMEOUT_MS = 20000

/**
 * Escape text before inserting it into HTML.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeHtml (value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

export class AssistantHintsSidebar {
    /** @type {import('node-red').NodeRedInstance|null} */
    RED = null
    assistantOptions = {}
    contentEl = null
    toolbarEl = null
    activeNodeId = null
    _tabRegistered = false
    _registerAttempts = 0
    _maxRetries = 8

    // ── AI hint tracking ─────────────────────────────────────────────────

    /**
     * Cache for AI-generated hints: nodeId → { fingerprint, hints, timestamp }
     * We key by nodeId so the cache is naturally invalidated when a node is
     * deleted and a new one gets the same id.
     *
     * @type {Map<string, {fingerprint: string, hints: string[], timestamp: number}>}
     */
    _aiHintsCache = new Map()

    /**
     * Nodes currently being fetched so we don't double-request.
     *
     * @type {Set<string>}
     */
    _aiHintsFetching = new Set()

    /**
     * Per-node attempt counter to cap retries.
     *
     * @type {Map<string, number>}
     */
    _aiHintsAttempts = new Map()

    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * @param {Object} params
     * @param {import('node-red').NodeRedInstance} params.RED
     * @param {Object} params.assistantOptions
     * @returns {void}
     */
    init ({ RED, assistantOptions = {} } = {}) {
        this.RED = RED
        this.assistantOptions = assistantOptions
        this.contentEl = this._createContentElement()
        this.toolbarEl = this._createToolbarElement()

        console.log('[nr-assistant:hints] init start', {
            hasSidebar: !!this.RED?.sidebar,
            hasContainsTab: typeof this.RED?.sidebar?.containsTab === 'function',
            hasAddTab: typeof this.RED?.sidebar?.addTab === 'function'
        })

        this.RED.actions?.add?.(SHOW_ACTION_ID, () => {
            console.log('[nr-assistant:hints] show action invoked')
            this.RED.sidebar?.show?.(TAB_ID)
        })

        this._registerEventListeners()
        // The tabs collection inside RED.sidebar is not guaranteed to be
        // initialised when the plugin onadd fires. Defer to the
        // first flows:loaded event, which always runs after
        // RED.sidebar.init() has finished. No refreshFromSelection
        // here — the initial load-time selection event is noise.
    }

    // ── HTML building ───────────────────────────────────────────────────────

    /**
     * @returns {HTMLDivElement|Object}
     */
    _createContentElement () {
        const el = document.createElement('div')
        el.className = 'red-ui-sidebar-tab-content nr-assistant-hints'
        el.style.padding = '12px'
        this._renderEmptyState(el)
        return el
    }

    /**
     * @returns {HTMLDivElement|Object}
     */
    _createToolbarElement () {
        const toolbar = document.createElement('div')
        toolbar.className = 'nr-assistant-hints-toolbar'
        toolbar.innerHTML = '<span class="red-ui-text-muted">AI guidance + local help</span>'
        return toolbar
    }

    // ── Event listeners ─────────────────────────────────────────────────────

    /**
     * Listen for the editor events most relevant to contextual help.
     *
     * @returns {void}
     */
    _registerEventListeners () {
        this.RED.events?.on?.('view:selection-changed', (event) => {
            console.log('[nr-assistant:hints] view:selection-changed', { count: Array.isArray(event?.nodes) ? event.nodes.length : 0 })
            this.refreshFromSelection(event)
        })
        this.RED.events?.on?.('nodes:change', (node) => {
            if (node?.id && node.id === this.activeNodeId) {
                console.log('[nr-assistant:hints] nodes:change refresh', { nodeId: node.id })
                this.refreshFromSelection()
            }
        })
        this.RED.events?.on?.('links:add', (link) => {
            if (!this.activeNodeId) return
            if (link?.source?.id === this.activeNodeId || link?.target?.id === this.activeNodeId) {
                console.log('[nr-assistant:hints] links:add refresh', { activeNodeId: this.activeNodeId })
                this.refreshFromSelection()
            }
        })
        this.RED.events?.on?.('editor:open', () => {
            console.log('[nr-assistant:hints] editor:open')
            this._ensureTabRegistered()
            this.refreshFromSelection()
        })
        this.RED.events?.on?.('flows:loaded', () => {
            console.log('[nr-assistant:hints] flows:loaded')
            this._ensureTabRegistered()
        })
    }

    // ── Tab registration ────────────────────────────────────────────────────

    /**
     * Register the sidebar tab once the editor's sidebar internals are ready.
     *
     * @returns {void}
     */
    _ensureTabRegistered () {
        if (this._tabRegistered) return
        if (this._registerAttempts >= this._maxRetries) {
            console.log('[nr-assistant:hints] max retries reached; giving up')
            return
        }
        if (typeof this.RED?.sidebar?.addTab !== 'function') {
            console.log('[nr-assistant:hints] sidebar.addTab not available yet')
            this._scheduleRegisterRetry()
            return
        }

        this._registerAttempts += 1
        try {
            this.RED.sidebar.addTab({
                id: TAB_ID,
                label: 'Hints',
                name: 'Assistant Hints',
                iconClass: 'fa fa-lightbulb-o',
                content: this.contentEl,
                toolbar: this.toolbarEl,
                enableOnEdit: true,
                action: SHOW_ACTION_ID
            })
            this._tabRegistered = true
            console.log('[nr-assistant:hints] tab ready')
        } catch (error) {
            console.log('[nr-assistant:hints] tab registration failed; will retry', {
                attempt: this._registerAttempts,
                max: this._maxRetries,
                error: error?.message || String(error)
            })
            this._scheduleRegisterRetry()
        }
    }

    /**
     * @returns {void}
     */
    _scheduleRegisterRetry () {
        if (this._tabRegistered) return
        if (this._registerAttempts >= this._maxRetries) return
        setTimeout(() => {
            this._ensureTabRegistered()
        }, 200)
    }

    // ── Selection refresh ───────────────────────────────────────────────────

    /**
     * Resolve the current node from an optional selection event and repaint the
     * sidebar accordingly.
     *
     * @param {Object} [event]
     * @returns {void}
     */
    refreshFromSelection (event = undefined) {
        const nodes = Array.isArray(event?.nodes)
            ? event.nodes
            : (this.RED.view?.selection?.()?.nodes || [])

        const activeNode = Array.isArray(nodes) && nodes.length > 0 ? nodes[0] : null
        this.activeNodeId = activeNode?.id || null

        if (!activeNode) {
            console.log('[nr-assistant:hints] refresh empty state')
            this._renderEmptyState(this.contentEl)
            return
        }

        const nodeContext = getNodeInstanceContext({ RED: this.RED, node: activeNode, doc: document })
        console.log('[nr-assistant:hints] refresh node context', {
            nodeId: activeNode.id,
            nodeType: activeNode.type,
            helpSummary: nodeContext?.helpSummary || null,
            defaultProperties: nodeContext?.defaultProperties || []
        })

        // Render immediately with local hints
        this._renderNodeContext({ node: activeNode, nodeContext, selectionCount: nodes.length })

        // Kick off async AI hints
        this._requestAIHints(activeNode, nodeContext)
    }

    // ── Connected nodes traversal ───────────────────────────────────────────

    /**
     * Find all nodes connected upstream and downstream of the given node.
     *
     * Node-RED stores wiring in `node.wires` as an array of arrays (one array
     * per output port, each containing target node IDs). To find upstream nodes
     * we must iterate all nodes and check which ones have wires pointing to us.
     *
     * @param {Object} node - The selected node instance
     * @returns {{upstream: Object[], downstream: Object[]}}
     */
    _getConnectedNodes (node) {
        const upstream = []
        const downstream = []

        // ── Downstream: follow node.wires (output ports → target IDs) ──
        if (Array.isArray(node.wires)) {
            // node.wires is [[targetId1, targetId2], [targetId3], ...] — one array per output
            for (const wireArray of node.wires) {
                if (!Array.isArray(wireArray)) continue
                for (const targetId of wireArray) {
                    if (!targetId) continue
                    const targetNode = this.RED?.nodes?.node?.(targetId)
                    if (targetNode) {
                        downstream.push(targetNode)
                    }
                }
            }
        }

        // ── Upstream: scan all nodes for wires pointing to this node ──
        // We use RED.nodes.eachNode if available, which iterates all nodes
        // including subflow instances. Fall back to RED.nodes.filterNodes
        // for older Node-RED versions.
        const allNodes = []
        if (typeof this.RED?.nodes?.eachNode === 'function') {
            this.RED.nodes.eachNode((n) => { allNodes.push(n) })
        } else if (typeof this.RED?.nodes?.filterNodes === 'function') {
            // filterNodes with a truthy predicate returns all nodes
            const result = this.RED.nodes.filterNodes({})
            if (Array.isArray(result)) {
                allNodes.push(...result)
            }
        }

        for (const other of allNodes) {
            if (other.id === node.id) continue
            if (!Array.isArray(other.wires)) continue

            for (const wireArray of other.wires) {
                if (!Array.isArray(wireArray)) continue
                if (wireArray.includes(node.id)) {
                    upstream.push(other)
                    break // Only add once even if connected via multiple output ports
                }
            }
        }

        return { upstream, downstream }
    }

    // ── Config extraction ───────────────────────────────────────────────────

    /**
     * Extract meaningful user-facing configuration from a node.
     *
     * We skip internal Node-RED properties (x, y, z, wires, id, type, etc.) and
     * only include fields the user would have edited in the edit dialog — URL,
     * method, function body, topic, payload type, etc. This is what the AI needs
     * to understand what the user has already configured.
     *
     * @param {Object} node
     * @returns {Object} key-value map of config property names to values
     */
    _getConfigSummary (node) {
        const skipKeys = new Set([
            'id', 'type', 'name', 'x', 'y', 'z', 'wires', 'd', 'g', 'l',
            'inputs', 'outputs', '_def', '_alias', '_flow', 'disabled'
            // Note: 'info' (user-authored description) is intentionally kept —
            // it tells the AI what the user wants this node to do.
        ])

        const config = {}
        for (const key of Object.keys(node)) {
            if (skipKeys.has(key)) continue
            if (key.startsWith('_')) continue

            const value = node[key]
            // Skip large values (full HTML templates, function bodies, etc.)
            // but still include their presence. The AI hint prompt builder below
            // will include truncated versions for the most useful fields.
            if (typeof value === 'string' && value.length > 500) {
                config[key] = '(long string — see field details below)'
            } else if (typeof value === 'object' && value !== null) {
                // Include a summary of arrays/objects, with a circular-ref guard.
                // Some node properties (especially on contrib nodes) contain
                // editor objects with circular references that break JSON.stringify.
                try {
                    config[key] = JSON.stringify(value).slice(0, 200)
                } catch (_e) {
                    config[key] = '[complex object]'
                }
            } else if (value !== undefined && value !== null && value !== '') {
                config[key] = value
            }
            // We omit undefined/null/empty-string values to keep the prompt clean
        }

        return config
    }


    // ── AI hint prompt building ─────────────────────────────────────────────

    /**
     * Build the user-facing prompt for the AI hint generator.
     *
     * We send the full flow context — every node and wire in the current tab —
     * so DeepSeek can suggest what nodes to add, what to wire up next, and how
     * the selected node fits into the bigger picture. The selected node is
     * marked so the LLM can focus its suggestions.
     *
     * @param {Object} node - The selected node instance
     * @param {Object} nodeContext - From getNodeInstanceContext()
     * @returns {string}
     */
    _buildHintPrompt (node, nodeContext) {
        const parts = []

        // ── Selected node: EVERYTHING we know ───────────────────────────
        // Dump all metadata, help docs, and raw config so DeepSeek has
        // maximum context for generating specific, actionable suggestions.
        parts.push('SELECTED NODE — all metadata and configuration:')
        parts.push('')

        // Node identity
        parts.push(`  id: ${node.id}`)
        parts.push(`  type: ${node.type}`)
        parts.push(`  name: ${node.name || '(unnamed)'}`)
        if (nodeContext?.module) parts.push(`  module: ${nodeContext.module}`)
        if (nodeContext?.category) parts.push(`  category: ${nodeContext.category}`)
        if (nodeContext?.paletteLabel && nodeContext.paletteLabel !== node.type) {
            parts.push(`  paletteLabel: ${nodeContext.paletteLabel}`)
        }
        parts.push(`  inputs: ${nodeContext?.inputs ?? node.inputs ?? 0}`)
        parts.push(`  outputs: ${nodeContext?.outputs ?? node.outputs ?? 0}`)
        parts.push(`  disabled: ${!!node.d}`)

        // ── User's own description (info field) — MOST IMPORTANT for guidance ──
        if (typeof node.info === 'string' && node.info.trim().length > 0) {
            parts.push('')
            parts.push(`  USER DESCRIPTION: ${node.info.trim()}`)
        }

        // Editable properties (what fields the edit dialog exposes)
        if (Array.isArray(nodeContext?.defaultProperties) && nodeContext.defaultProperties.length > 0) {
            parts.push(`  editableProperties: ${nodeContext.defaultProperties.join(', ')}`)
        }

        // ── Full help documentation ──
        if (nodeContext?.helpHtml) {
            // Strip HTML tags for a cleaner prompt, keep up to 3000 chars of docs
            const plainHelp = nodeContext.helpHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
            const truncated = plainHelp.length > 3000
                ? plainHelp.slice(0, 3000) + ' ... (truncated)'
                : plainHelp
            parts.push('')
            parts.push(`  FULL HELP DOCS:\n  ${truncated}`)
        } else if (nodeContext?.helpSummary) {
            parts.push(`  helpSummary: ${nodeContext.helpSummary}`)
        }

        // ── Raw configuration (every property on the node, unfiltered) ──
        const rawConfig = stripNodeCruft(node)
        if (Object.keys(rawConfig).length > 0) {
            parts.push('')
            parts.push('  RAW CONFIGURATION:')
            for (const [key, value] of Object.entries(rawConfig)) {
                parts.push(`    ${key}: ${value}`)
            }
        } else {
            parts.push('  No configuration set (all defaults).')
        }

        // ── Key fields with full content ──
        if (typeof node.func === 'string') {
            const truncated = node.func.length > 3000
                ? node.func.slice(0, 3000) + '\n// ... (truncated)'
                : node.func
            parts.push(`\n  FUNCTION BODY:\n\`\`\`javascript\n${truncated}\n\`\`\``)
        }
        if (typeof node.template === 'string') {
            const truncated = node.template.length > 3000
                ? node.template.slice(0, 3000) + '\n<!-- ... (truncated) -->'
                : node.template
            parts.push(`\n  TEMPLATE BODY:\n\`\`\`\n${truncated}\n\`\`\``)
        }

        // ── Explicitly connected nodes (upstream and downstream) ──────
        const { upstream, downstream } = this._getConnectedNodes(node)
        parts.push(buildConnectedNodesText({ upstream, downstream }))

        // ── Full flow context (all nodes in the current tab) ──
        parts.push(buildFlowContextText({ RED: this.RED, selectedNode: node }))

        return parts.join('\n')
    }

    // ── AI hint request ─────────────────────────────────────────────────────

    /**
     * Request AI-generated hints for the selected node.
     *
     * We cache hints per node+fingerprint to avoid redundant requests. When the
     * node's configuration or wiring changes, the fingerprint changes and we
     * re-request. We also cap the total number of attempts per node to prevent
     * runaway costs from rapid edits.
     *
     * @param {Object} node
     * @param {Object} nodeContext
     * @returns {void}
     */
    _requestAIHints (node, nodeContext) {
        const nodeId = node.id
        if (!nodeId) return

        // Remember the node so hint-resolution exit points can emit a synthetic
        // event carrying it for downstream consumers (inline annotations).
        this._lastRequestedNode = node

        // ── Check cache ──
        const fingerprint = fingerprintNode({ node, upstream: this._getConnectedNodes(node).upstream, downstream: this._getConnectedNodes(node).downstream })
        const cached = this._aiHintsCache.get(nodeId)
        if (cached && cached.fingerprint === fingerprint) {
            // Cache hit — update the hints section without a full repaint
            console.log('[nr-assistant:hints] AI hints cache hit', { nodeId })
            this._injectAIHints(cached.hints)
            this._emitHintsReady(node, cached.hints)
            return
        }

        // ── Guard against duplicate requests and cap attempts ──
        if (this._aiHintsFetching.has(nodeId)) return

        const attempts = this._aiHintsAttempts.get(nodeId) || 0
        if (attempts >= MAX_AI_HINT_ATTEMPTS) return

        // ── Build prompt ──
        const prompt = this._buildHintPrompt(node, nodeContext)
        if (!prompt || prompt.length < 20) return

        // ── Check if jQuery is available ──
        if (typeof globalThis.$ === 'undefined' || typeof globalThis.$.ajax !== 'function') {
            console.log('[nr-assistant:hints] jQuery not available for AI hints request')
            return
        }

        // ── Check if AI is enabled ──
        if (!this.assistantOptions?.enabled) {
            console.log('[nr-assistant:hints] AI not enabled — skipping AI hints')
            return
        }

        this._aiHintsFetching.add(nodeId)
        this._aiHintsAttempts.set(nodeId, attempts + 1)

        const transactionId = `hint-${nodeId}-${Date.now()}`

        console.log('[nr-assistant:hints] requesting AI hints', {
            nodeId,
            nodeType: node.type,
            promptLength: prompt.length,
            attempt: attempts + 1
        })

        globalThis.$.ajax({
            url: 'nr-assistant/hint',
            type: 'POST',
            data: JSON.stringify({
                prompt,
                transactionId,
                context: {
                    type: node.type,
                    scope: 'hint',
                    nodeContext: toPromptNodeContext(nodeContext)
                }
            }),
            contentType: 'application/json',
            timeout: AI_HINT_TIMEOUT_MS,
            success: (reply) => {
                this._aiHintsFetching.delete(nodeId)

                // The hint endpoint returns { status: 'ok', data: { hints: [...] } }
                // The data can be nested at data.data (from DeepSeek _parseResponseText
                // which puts parsed JSON under data) or directly at data.
                const hintData = reply?.data?.data || reply?.data
                const hints = hintData?.hints

                if (!Array.isArray(hints) || hints.length === 0) {
                    console.log('[nr-assistant:hints] AI hints: no hints in response', { reply })
                    // Cache the empty result so we don't keep re-requesting
                    this._aiHintsCache.set(nodeId, { fingerprint, hints: [], timestamp: Date.now() })
                    this._injectAIHints([])
                    this._emitHintsReady(node, [])
                    return
                }

                // Cache and display
                this._aiHintsCache.set(nodeId, {
                    fingerprint,
                    hints,
                    timestamp: Date.now()
                })

                console.log('[nr-assistant:hints] AI hints received', {
                    nodeId,
                    hintCount: hints.length
                })

                this._injectAIHints(hints)
                this._emitHintsReady(node, hints)
            },
            error: (jqXHR, textStatus, errorThrown) => {
                this._aiHintsFetching.delete(nodeId)
                // Don't cache on failure — we'll retry if the node changes again
                console.log('[nr-assistant:hints] AI hints request failed', {
                    nodeId,
                    textStatus,
                    errorThrown: errorThrown?.message || String(errorThrown)
                })
                this._injectAIHintsError()
            }
        })
    }

    /**
     * Inject AI hints into the already-rendered panel without a full repaint.
     *
     * @param {string[]} hints
     * @returns {void}
     */
    _injectAIHints (hints) {
        const aiSection = this.contentEl?.querySelector?.('.nr-assistant-hints-ai')
        if (!aiSection) return

        if (!hints || hints.length === 0) {
            aiSection.innerHTML = `
                <h4 style="margin-top:0;margin-bottom:4px;">💡 Suggestions</h4>
                <p class="red-ui-text-muted">No specific suggestions — try configuring the node's key fields.</p>
            `
            return
        }

        const hintItems = hints.map(
            hint => `<li style="margin-bottom:6px;">${escapeHtml(hint)}</li>`
        ).join('')

        aiSection.innerHTML = `
            <h4 style="margin-top:0;margin-bottom:4px;">💡 Suggestions</h4>
            <ul style="padding-left:18px;margin-top:4px;">${hintItems}</ul>
        `
    }

    /**
     * Show an error state for AI hints.
     *
     * @returns {void}
     */
    _injectAIHintsError () {
        const aiSection = this.contentEl?.querySelector?.('.nr-assistant-hints-ai')
        if (!aiSection) return

        aiSection.innerHTML = `
            <h4 style="margin-top:0;margin-bottom:4px;">💡 Suggestions</h4>
            <p class="red-ui-text-muted">Couldn't load suggestions. They'll retry when the node changes.</p>
        `
    }

    /**
     * Emit a synthetic event carrying resolved hints for downstream consumers
     * (e.g. InlineAnnotations, which renders them as ephemeral comment nodes).
     *
     * This decouples the renderer from the fetcher: hintsSidebar stays the
     * data source, the inline-annotations module owns canvas rendering. Empty
     * hints are also emitted so stale annotations get pruned.
     *
     * @param {Object} node - The target node the hints describe.
     * @param {string[]} hints - Resolved hint strings (may be empty).
     * @returns {void}
     */
    _emitHintsReady (node, hints) {
        try {
            this.RED?.events?.emit?.('nr-assistant:hints-ready', { node, hints: hints || [] })
        } catch (error) {
            console.log('[nr-assistant:hints] hints-ready emit failed', {
                nodeId: node?.id,
                error: error?.message || String(error)
            })
        }
    }

    // ── Label suggestion ────────────────────────────────────────────────────

    /**
     * Build a lightweight label suggestion.
     *
     * @param {Object} params
     * @param {Object} params.node
     * @param {Object} params.nodeContext
     * @returns {string}
     */
    buildLabelSuggestion ({ node, nodeContext }) {
        if (node?.name) return node.name

        const type = node?.type || nodeContext?.type
        if (type === 'function') return 'Transform message'
        if (type === 'change') return 'Change message'
        if (type === 'switch') return 'Route message'
        if (type === 'inject') return 'Inject trigger'
        if (type === 'http request') return 'Fetch HTTP resource'
        if (type === 'http in') return 'Handle HTTP request'
        if (type === 'comment') return 'Flow note'

        return nodeContext?.paletteLabel || type || 'Unnamed node'
    }

    // ── Local hints (cheap, immediate) ──────────────────────────────────────

    /**
     * Build a small set of local heuristics hints that display immediately
     * before the AI hints load.
     *
     * @param {Object} params
     * @param {Object} params.node
     * @param {Object} params.nodeContext
     * @returns {string[]}
     */
    buildHints ({ node, nodeContext }) {
        const hints = []

        if (nodeContext?.helpTooltip) {
            hints.push(nodeContext.helpTooltip)
        } else if (nodeContext?.helpSummary) {
            hints.push(nodeContext.helpSummary)
        }

        if (nodeContext?.defaultProperties?.includes('name')) {
            hints.push('Give important nodes a short readable name so future-you can scan the flow quickly.')
        }

        if ((nodeContext?.outputs || 0) > 1) {
            hints.push(`This node exposes ${nodeContext.outputs} outputs. Consider whether each branch should have a distinct purpose/label.`)
        }

        return hints.slice(0, 2)
    }

    // ── Label suggestion display ────────────────────────────────────────────

    /**
     * Display an LLM-generated label suggestion in the sidebar.
     *
     * @param {Object} node
     * @param {string} label
     * @returns {void}
     */
    showLabelSuggestion (node, label) {
        if (!this.contentEl) return
        if (!this.RED?.nodes?.node?.(node.id)) return // Node was deleted

        this._renderEmptyState(this.contentEl)
        this.contentEl.innerHTML = `
            <div class="red-ui-help nr-assistant-hints-panel">
                <h3 style="margin-top:0;">AI Label Suggestion</h3>
                <p>For <code>${escapeHtml(node.type || 'unknown')}</code> node:</p>
                <p style="font-size:1.2em;"><strong>“${escapeHtml(label)}”</strong></p>
                <p class="red-ui-text-muted">A more specific label was suggested by the AI. You can rename the node manually in its edit dialog, or clear the name to let auto-labelling take over.</p>
            </div>
        `
        console.log('[nr-assistant:hints] label suggestion shown', { nodeId: node.id, label })
    }

    // ── Rendering ───────────────────────────────────────────────────────────

    /**
     * @param {HTMLElement|Object} target
     * @returns {void}
     */
    _renderEmptyState (target) {
        target.innerHTML = `
            <div class="red-ui-help">
                <h3 style="margin-top:0;">Assistant Hints</h3>
                <p>Select a node to see AI guidance, label suggestions, and contextual hints.</p>
            </div>
        `
    }

    /**
     * Render the node context panel — just the AI hints section.
     *
     * Everything else (type, label, summary, editable properties) is stripped
     * per user request. The panel is exclusively for AI-generated suggestions.
     *
     * @param {Object} params
     * @param {Object} params.node
     * @param {Object} params.nodeContext
     * @param {number} params.selectionCount
     * @returns {void}
     */
    _renderNodeContext ({ node, nodeContext, selectionCount }) {
        const selectionNote = selectionCount > 1
            ? `<p class="red-ui-text-muted" style="margin-bottom:8px;">Showing the first of ${selectionCount} selected nodes.</p>`
            : ''

        this.contentEl.innerHTML = `
            <div class="red-ui-help nr-assistant-hints-panel">
                ${selectionNote}
                <div class="nr-assistant-hints-ai">
                    <h4 style="margin-top:0;margin-bottom:4px;">💡 Suggestions for <code>${escapeHtml(node?.type || 'unknown')}</code></h4>
                    <p class="red-ui-text-muted"><i>Loading suggestions...</i></p>
                </div>
            </div>
        `
    }
}

export { SHOW_ACTION_ID, TAB_ID }

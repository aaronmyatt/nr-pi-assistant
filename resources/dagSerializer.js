// ============================================================================
// DAG Serializer — Canonical prompt-friendly flow representation
// ============================================================================
//
// Single source of truth for serialising the Node-RED flow DAG into a stable,
// prompt-friendly representation. Used by hintsSidebar, and designed for
// future agents (next-node, next-config, label) so context and fingerprinting
// stay consistent across all AI consumers.
//
// Why one module:
// - hintsSidebar had an ad-hoc prompt builder AND a separate fingerprint,
//   with duplicated cruft-skip rules that drifted out of sync.
// - autoLabeler had its own fingerprint with different skip-sets.
// - Future agents need the same DAG view — one module prevents drift.
//
// Exports:
//   CRUFT_KEYS         — canonical set of node properties to strip
//   stripNodeCruft()   — return only meaningful config, truncated
//   fingerprintNode()  — stable hash for cache invalidation
//   getFlowName()      — resolve the active workspace/label
//   buildFlowContextText() — text block: all nodes + readable wiring
//   buildConnectedNodesText() — text block: upstream/downstream nodes
//
// Ref: resources/hintsSidebar.js (consumer)
//
// Examples:
//   import { fingerprintNode, stripNodeCruft } from './dagSerializer.js'
//   const fp = fingerprintNode({ node, upstream: [...], downstream: [...] })
//   const clean = stripNodeCruft(node)

/**
 * Canonical skip-set for node properties. Every consumer that strips node
 * config MUST use this set so behaviour is consistent.
 *
 * Kept: 'info' (user description), all configurable fields.
 * Stripped: position (x/y/z), internal ids (_def, _alias, _flow), wiring
 *   (wires), presentation metadata (g, l, d, inputs, outputs, disabled).
 */
// Node-RED adds transient runtime properties ('changed', 'dirty') that flip
// during editing — they must be excluded from fingerprints or the cache
// will never hit. Ref: https://nodered.org/docs/api/ui/editableList/
export const CRUFT_KEYS = new Set([
    'id', 'type', 'name', 'x', 'y', 'z', 'wires', 'd', 'g', 'l',
    'inputs', 'outputs', 'changed', 'dirty',
    '_def', '_alias', '_flow', 'disabled'
])

/** @type {number} Max config string length before truncation. */
const CONFIG_STRING_MAX = 500

// ── Public exports ──────────────────────────────────────────────────────────

/**
 * Strip cruft from a node, returning only meaningful configuration.
 *
 * Skips keys in {@link CRUFT_KEYS} and any `_`-prefixed private fields.
 * Truncates strings and JSON-serialised objects at {@link CONFIG_STRING_MAX}.
 * Safe against circular references (falls back to '[non-serializable]').
 *
 * @param {Object} node - A Node-RED node instance.
 * @returns {Object} Cleaned config map (key → value).
 */
export function stripNodeCruft (node) {
    const config = {}
    for (const key of Object.keys(node)) {
        if (CRUFT_KEYS.has(key)) continue
        if (key.startsWith('_')) continue

        const value = node[key]
        if (value === undefined || value === null) continue

        if (typeof value === 'string') {
            config[key] = value.length > CONFIG_STRING_MAX
                ? value.slice(0, CONFIG_STRING_MAX) + '...'
                : value
        } else if (typeof value === 'object') {
            try {
                const json = JSON.stringify(value)
                config[key] = json.length > CONFIG_STRING_MAX
                    ? json.slice(0, CONFIG_STRING_MAX) + '...'
                    : json
            } catch (_e) {
                // Circular refs or non-serializable objects (e.g. editor
                // instances on contrib nodes).
                config[key] = '[non-serializable]'
            }
        } else {
            // booleans, numbers — include directly
            config[key] = value
        }
    }
    return config
}

/**
 * Create a stable fingerprint for cache invalidation.
 *
 * The fingerprint includes the node's type, all meaningful config keys
 * (sorted for stability), and the upstream/downstream wiring topology.
 * A change to any config value or wiring produces a different fingerprint,
 * which triggers a fresh AI request.
 *
 * String values longer than 200 chars are truncated to the first 200 —
 * enough to detect meaningful edits without bloating the fingerprint.
 *
 * @param {Object} params
 * @param {Object} params.node - The node to fingerprint.
 * @param {Object[]} params.upstream - Nodes wired into this node.
 * @param {Object[]} params.downstream - Nodes this node feeds into.
 * @returns {string} Stable JSON fingerprint.
 */
export function fingerprintNode ({ node, upstream = [], downstream = [] }) {
    const skipForFingerprint = new Set([
        ...CRUFT_KEYS,
        'name', 'type', 'outputs', 'inputs' // also skip for fingerprinting
    ])

    const configKeys = Object.keys(node)
        .filter(k => !skipForFingerprint.has(k) && !k.startsWith('_'))
        .sort()

    const configEntries = configKeys.map(k => {
        const v = node[k]
        if (typeof v === 'string' && v.length > 200) {
            return `${k}:${v.slice(0, 200)}`
        }
        try {
            return `${k}:${JSON.stringify(v)}`
        } catch (_e) {
            return `${k}:[non-serializable]`
        }
    }).join(';')

    const meaningful = {
        t: node.type,
        c: configEntries,
        // Wiring topology — sorted ids for stability
        up: upstream.map(n => n.id).sort().join(','),
        down: downstream.map(n => n.id).sort().join(',')
    }
    return JSON.stringify(meaningful)
}

/**
 * Resolve the label/name of the currently active workspace tab.
 *
 * @param {Object} RED - Node-RED instance.
 * @returns {string} Flow name, or 'unknown flow' if unresolvable.
 */
export function getFlowName (RED) {
    try {
        const activeTab = RED?.workspaces?.active?.()
        if (!activeTab) return 'unknown flow'
        const tab = RED?.nodes?.workspace?.(activeTab) || RED?.nodes?.subflow?.(activeTab)
        return tab?.label || tab?.name || 'untitled flow'
    } catch (_e) {
        return 'unknown flow'
    }
}

// ── Text builders (consumed by hintsSidebar) ────────────────────────────────

/**
 * Build a text block describing all nodes in the flow with readable wiring.
 *
 * Uses node types and user-assigned names (not opaque IDs) for wire labels
 * so the LLM can understand the topology.
 *
 * @param {Object} params
 * @param {Object} params.RED - Node-RED instance.
 * @param {Object} params.selectedNode - The node the user has selected.
 * @returns {string} Multi-line text block.
 */
export function buildFlowContextText ({ RED, selectedNode }) {
    const flowName = getFlowName(RED)
    const lines = []
    lines.push('')
    lines.push(`FLOW CONTEXT — all nodes in the tab "${flowName}":`)
    lines.push('')

    // Collect all nodes in the current workspace.
    const allNodes = []
    if (typeof RED?.nodes?.eachNode === 'function') {
        RED.nodes.eachNode((n) => { allNodes.push(n) })
    } else if (typeof RED?.nodes?.filterNodes === 'function') {
        const result = RED.nodes.filterNodes({})
        if (Array.isArray(result)) allNodes.push(...result)
    }

    // Build id→label lookup for readable wire annotations.
    const idLabel = {}
    for (const n of allNodes) {
        const label = n.name ? `"${n.name}"` : `[${n.type}]`
        idLabel[n.id] = `${n.type} ${label}`.trim()
    }

    for (const n of allNodes) {
        const marker = n.id === selectedNode.id ? ' ★ SELECTED' : ''
        const label = n.name ? `"${n.name}"` : ''
        const nodeDesc = `[${n.type}]${marker} ${label}`.trim()

        const wires = []
        if (Array.isArray(n.wires)) {
            for (const w of n.wires) {
                if (Array.isArray(w) && w.length > 0) {
                    wires.push(...w.filter(Boolean).map(tid => {
                        const tLabel = idLabel[tid] || tid
                        return `${n.type}→${tLabel}`
                    }))
                }
            }
        }

        if (wires.length > 0) {
            lines.push(`${nodeDesc}`)
            for (const wire of wires) {
                lines.push(`  wire: ${wire}`)
            }
        } else {
            lines.push(`${nodeDesc} (unwired)`)
        }
    }

    if (lines.length <= 2) lines.push('  (no nodes in this flow)')
    return lines.join('\n')
}

/**
 * Build a text block listing the selected node's upstream and downstream
 * connections with readable labels and clear instructions not to suggest
 * adding nodes that already exist.
 *
 * @param {Object} params
 * @param {Object[]} params.upstream - Nodes wired into the selected node.
 * @param {Object[]} params.downstream - Nodes the selected node feeds into.
 * @returns {string} Multi-line text block.
 */
export function buildConnectedNodesText ({ upstream = [], downstream = [] }) {
    const parts = []

    parts.push('')
    if (upstream.length > 0) {
        parts.push('UPSTREAM — nodes wired INTO this node (already connected, DO NOT suggest adding):')
        for (const u of upstream) {
            const uname = u.name ? ` "${u.name}"` : ''
            parts.push(`  [${u.type}]${uname}`)
        }
    } else {
        parts.push('UPSTREAM: none (this node has no input connections yet)')
    }

    parts.push('')
    if (downstream.length > 0) {
        parts.push('DOWNSTREAM — nodes this node feeds INTO (already connected, DO NOT suggest adding):')
        for (const d of downstream) {
            const dname = d.name ? ` "${d.name}"` : ''
            parts.push(`  [${d.type}]${dname}`)
        }
    } else {
        parts.push('DOWNSTREAM: none (this node has no output connections yet)')
    }

    return parts.join('\n')
}

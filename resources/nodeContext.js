// ============================================================================
// Node Context Helpers
// ============================================================================
//
// This module centralises the editor-side logic for turning a Node-RED node type
// or node instance into a richer, human-readable context object. We intentionally
// keep this work in the browser because the browser already has access to the
// installed node help blobs (`script[data-help-name]`) that Node-RED injects
// into the editor page for every loaded node set.
//
// Why this exists:
// - AI prompts benefit from more than raw `type` ids.
// - future sidebar hints / auto-labelling should use the same metadata seam.
// - installed help text is authoritative for the exact node version currently
//   loaded in the editor and works offline.
//
// Ref: https://nodered.org/docs/creating-nodes/node-html
// Ref: https://nodered.org/docs/creating-nodes/appearance
//
// Examples:
//   const ctx = getNodeTypeContext({ RED, type: 'function' })
//   console.log(ctx.helpSummary)
//
//   const nodeCtx = getNodeInstanceContext({ RED, node: RED.view.selection().nodes[0] })
//   console.log(nodeCtx.paletteLabel, nodeCtx.workspaceLabel)

/**
 * Collapse whitespace so summaries are readable in prompts and UI badges.
 *
 * @param {string} value
 * @returns {string}
 */
function collapseWhitespace (value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
}

/**
 * Strip HTML to plain text.
 *
 * We prefer using a temporary DOM element because it mirrors how the browser
 * would render the help content. When a DOM is not available (for example in
 * frontend unit tests running under Node), we fall back to a simple tag-stripper.
 *
 * @param {string} html
 * @param {Document} [doc]
 * @returns {string}
 */
export function stripHtmlToText (html, doc = globalThis.document) {
    if (!html) return ''

    if (doc && typeof doc.createElement === 'function') {
        const container = doc.createElement('div')
        container.innerHTML = html
        return collapseWhitespace(container.textContent || container.innerText || '')
    }

    return collapseWhitespace(String(html).replace(/<[^>]+>/g, ' '))
}

/**
 * Extract the first paragraph from rendered help HTML.
 *
 * Node-RED uses the first `<p>` in node help as the palette tooltip, so reusing
 * that convention gives us a concise, author-provided summary instead of asking
 * the model to infer one from the whole help document.
 *
 * Ref: https://nodered.org/docs/creating-nodes/node-html
 *
 * @param {string} html
 * @param {Document} [doc]
 * @returns {string}
 */
export function getHelpTooltipFromHtml (html, doc = globalThis.document) {
    if (!html) return ''

    if (doc && typeof doc.createElement === 'function') {
        const container = doc.createElement('div')
        container.innerHTML = html
        const firstParagraph = container.querySelector('p')
        if (firstParagraph) {
            return collapseWhitespace(firstParagraph.textContent || '')
        }
        return stripHtmlToText(html, doc)
    }

    const match = String(html).match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)
    if (match) {
        return stripHtmlToText(match[1], doc)
    }
    return stripHtmlToText(html, doc)
}

/**
 * Locate the raw help script element for a node type.
 *
 * Node-RED injects node help into the editor DOM under
 * `script[data-help-name="<type>"]`. This mirrors the editor's own lookup path.
 *
 * @param {Object} params
 * @param {string} params.type
 * @param {Document} [params.doc]
 * @returns {HTMLScriptElement|null}
 */
export function getNodeHelpScriptElement ({ type, doc = globalThis.document } = {}) {
    if (!type || !doc || typeof doc.querySelector !== 'function') {
        return null
    }
    return doc.querySelector(`script[data-help-name="${type}"]`)
}

/**
 * Render the installed node help content to HTML.
 *
 * Some help blocks are plain HTML; others may be stored as markdown and need to
 * pass through `RED.utils.renderMarkdown`, which is exactly what the Node-RED
 * editor does internally when reading node help.
 *
 * @param {Object} params
 * @param {any} params.RED
 * @param {HTMLScriptElement|null} params.helpElement
 * @returns {string|null}
 */
export function renderNodeHelpHtml ({ RED, helpElement } = {}) {
    if (!helpElement) return null

    const raw = helpElement.innerHTML || helpElement.textContent || ''
    const helpType = helpElement.getAttribute?.('type') || ''

    if (helpType === 'text/markdown' && RED?.utils?.renderMarkdown) {
        return RED.utils.renderMarkdown(raw)
    }

    return raw || null
}

/**
 * Summarise rendered help content into the fields we care about most.
 *
 * @param {Object} params
 * @param {string|null} params.helpHtml
 * @param {Document} [params.doc]
 * @returns {{helpHtml: string|null, helpSummary: string|null, helpTooltip: string|null}}
 */
export function summariseNodeHelp ({ helpHtml, doc = globalThis.document } = {}) {
    if (!helpHtml) {
        return {
            helpHtml: null,
            helpSummary: null,
            helpTooltip: null
        }
    }

    const helpTooltip = getHelpTooltipFromHtml(helpHtml, doc) || null
    const helpSummary = helpTooltip || stripHtmlToText(helpHtml, doc) || null

    return {
        helpHtml,
        helpSummary,
        helpTooltip
    }
}

/**
 * Encode values from a node definition so they can be safely serialised through
 * JSON without losing important metadata such as functions or non-finite values.
 *
 * This mirrors the project's existing `GET_NODE_TYPES` behaviour so downstream
 * consumers can keep using the same wire format while gaining richer help data.
 *
 * @param {any} value
 * @returns {any}
 */
export function encodeNodeDefinitionValue (value) {
    if (typeof value === 'function') return { __enc__: true, type: 'function', data: value.toString() }
    if (typeof value === 'bigint') return { __enc__: true, type: 'bigint', data: value.toString() }
    if (typeof value === 'number' && (isNaN(value) || !isFinite(value))) return { __enc__: true, type: 'number', data: String(value) }
    if (value instanceof RegExp) return { __enc__: true, type: 'regexp', data: value.toString() }
    if (value instanceof Set) return { __enc__: true, type: 'set', data: Array.from(value), length: value.size }
    if (value instanceof Map) return { __enc__: true, type: 'map', data: Object.fromEntries(value.entries()), length: value.size }
    return value
}

/**
 * Safely evaluate a node definition label-like property.
 *
 * Label functions are allowed by Node-RED. We keep evaluation defensive because
 * contrib nodes sometimes assume a richer `this` object than we have in a given
 * context. On failure we fall back instead of throwing.
 *
 * Ref: https://nodered.org/docs/creating-nodes/appearance
 *
 * @param {Object} params
 * @param {string} params.type
 * @param {Object} [params.def]
 * @param {Object} [params.node]
 * @param {'label'|'paletteLabel'} params.property
 * @returns {string|null}
 */
export function evaluateNodeLabelProperty ({ type, def, node, property } = {}) {
    if (!def) return type || null

    const value = def[property]
    if (typeof value === 'undefined') {
        return property === 'paletteLabel' ? (type || null) : null
    }

    try {
        if (typeof value === 'function') {
            const context = node || def
            const result = value.call(context)
            return typeof result === 'string' ? result : (result != null ? String(result) : null)
        }
        return typeof value === 'string' ? value : (value != null ? String(value) : null)
    } catch (_error) {
        return property === 'paletteLabel' ? (type || null) : null
    }
}

/**
 * Build enriched type-level context for a node.
 *
 * @param {Object} params
 * @param {any} params.RED
 * @param {string} params.type
 * @param {Object} [params.node]
 * @param {Document} [params.doc]
 * @returns {Object}
 */
export function getNodeTypeContext ({ RED, type, node = null, doc = globalThis.document } = {}) {
    if (!RED?.nodes?.getType || !type) {
        return { installed: false }
    }

    const def = RED.nodes.getType(type)
    if (!def) {
        return { installed: false }
    }

    const helpElement = getNodeHelpScriptElement({ type, doc })
    const helpHtml = renderNodeHelpHtml({ RED, helpElement })
    const help = summariseNodeHelp({ helpHtml, doc })
    const workspaceLabel = node?.name || evaluateNodeLabelProperty({ type, def, node, property: 'label' }) || type

    return {
        type,
        module: node?._def?.set?.module || def?.set?.module || 'node-red',
        category: def.category || null,
        defaults: JSON.parse(JSON.stringify(def.defaults || {}, (key, value) => encodeNodeDefinitionValue(value))),
        defaultProperties: Object.keys(def.defaults || {}),
        label: def.label ? encodeNodeDefinitionValue(def.label) : type,
        paletteLabel: evaluateNodeLabelProperty({ type, def, property: 'paletteLabel' }) || type,
        workspaceLabel,
        color: def.color ? encodeNodeDefinitionValue(def.color) : null,
        inputs: def.inputs ?? 0,
        outputs: def.outputs ?? 0,
        ...help
    }
}

/**
 * Build enriched instance-level context for a specific node on the canvas.
 *
 * @param {Object} params
 * @param {any} params.RED
 * @param {Object} params.node
 * @param {Document} [params.doc]
 * @returns {Object}
 */
export function getNodeInstanceContext ({ RED, node, doc = globalThis.document } = {}) {
    if (!node?.type) {
        return { installed: false }
    }

    return {
        ...getNodeTypeContext({ RED, type: node.type, node, doc }),
        id: node.id,
        name: node.name || '',
        disabled: !!node.d,
        z: node.z || null
    }
}

/**
 * Reduce the full node context down to prompt-safe fields.
 *
 * Full help HTML and encoded defaults are useful for editor features, but they
 * are often too noisy to send with every AI request. This helper keeps the
 * prompt-facing payload concise while preserving the richer browser-side object.
 *
 * @param {Object} nodeContext
 * @returns {Object|null}
 */
export function toPromptNodeContext (nodeContext) {
    if (!nodeContext || nodeContext.installed === false) {
        return null
    }

    return {
        type: nodeContext.type,
        module: nodeContext.module,
        category: nodeContext.category,
        inputs: nodeContext.inputs,
        outputs: nodeContext.outputs,
        paletteLabel: nodeContext.paletteLabel,
        workspaceLabel: nodeContext.workspaceLabel,
        defaultProperties: nodeContext.defaultProperties,
        helpSummary: nodeContext.helpSummary,
        helpTooltip: nodeContext.helpTooltip
    }
}

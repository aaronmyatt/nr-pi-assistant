/**
 * AiBackend — pluggable AI backend interface for the Node-RED Assistant plugin.
 *
 * The plugin originally hardcoded HTTP POSTs to FlowFuse Cloud. This interface
 * decouples the handlers from any specific backend so we can swap in pi-rpc,
 * pi-ai in-process, or keep the original FlowFuse backend for parity testing.
 *
 * Each backend implementation lives in lib/ai/backends/.
 *
 * @typedef {Object} AiRequest
 * @property {string} feature   - Feature identifier (e.g. 'method:function', 'fim', 'explain_flow')
 * @property {string} prompt    - The user/composed prompt text
 * @property {any}    [context] - Additional context (selected code, node metadata, MCP payload, etc.)
 * @property {string} transactionId
 * @property {function} [onDelta] - Called with each streaming text delta: (delta: string) => void
 *
 * @typedef {Object} AiResult
 * @property {any} data - MUST match the shape the browser expects for this feature (see lib/ai/prompts/response-data-shapes.md)
 */

/** @interface */
class AiBackend {
    /**
     * Execute an AI request and return the result.
     * @param {AiRequest} req
     * @returns {Promise<AiResult>}
     */
    async run (req) {
        throw new Error('not implemented')
    }

    /**
     * Release any resources (processes, sessions, connections).
     * Called on plugin dispose or re-init.
     */
    async dispose () {}

    /**
     * Whether the backend is ready to accept requests.
     * @returns {boolean}
     */
    get ready () {
        return true
    }
}

module.exports = { AiBackend }

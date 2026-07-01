/**
 * FlowFuse backend — preserves the original got.post behaviour for parity testing.
 *
 * Wraps the existing HTTP-to-FlowFuse-Cloud calls inside the AiBackend interface
 * so the handlers don't need to know about HTTP, tokens, or base URLs.
 *
 * This backend is optional and disabled by default post-migration. It exists
 * so we can run side-by-side comparisons against the flowfuse-original submodule
 * during development and testing.
 */

const { AiBackend } = require('../backend.js')

class FlowFuseBackend extends AiBackend {
    /**
     * @param {Object} options
     * @param {string} options.url - Base URL for the FlowFuse Assistant API (e.g. https://app.flowfuse.com/api/v1/assistant/)
     * @param {string} options.token - Bearer token for auth (optional; only needed for non-standalone mode)
     * @param {Object} options.got - got HTTP client instance
     * @param {Object} options.RED - Node-RED instance (for logging)
     */
    constructor ({ url, token, got, RED }) {
        super()
        this._url = url
        this._token = token
        this._got = got
        this._RED = RED
    }

    /**
     * Maps feature identifiers to FlowFuse API paths.
     * Most features go to /{url}/{method}. FIM and explain_flow have dedicated paths.
     */
    _buildUrl (feature) {
        const base = this._url.replace(/\/$/, '')
        if (feature.startsWith('method:')) {
            const method = feature.slice(7)
            return `${base}/${method}`
        }
        if (feature === 'fim') {
            // The actual FIM URL includes nodeModule/nodeType; those come via context
            // and are handled in the run() override
            return `${base}/fim`
        }
        if (feature === 'explain_flow') {
            return `${base}/mcp`
        }
        // Default: treat feature as the method name for generic /{url}/{method}
        return `${base}/${feature}`
    }

    async run (req) {
        const { feature, prompt, context, transactionId } = req
        const url = this._buildUrl(feature)

        const body = {
            prompt,
            context,
            transactionId
        }

        const headers = {
            Accept: '*/*',
            'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
            'Content-Type': 'application/json',
            'User-Agent': 'FlowFuse Assistant Plugin/' + require('../../package.json').version
        }

        // Only add auth if we have a token (standalone mode may not)
        if (this._token) {
            headers.Authorization = `Bearer ${this._token}`
        }

        try {
            const response = await this._got.post(url, {
                headers,
                json: body
            })
            const data = JSON.parse(response.body)
            return { data }
        } catch (error) {
            let message = 'FlowFuse Expert request was unsuccessful'
            this._RED?.log?.trace('nr-assistant error:', error)
            this._RED?.log?.warn(message)
            throw error
        }
    }
}

module.exports = { FlowFuseBackend }

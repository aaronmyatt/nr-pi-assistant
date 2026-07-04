/**
 * DeepSeekBackend — AiBackend implementation that calls DeepSeek directly.
 *
 * Why this backend exists:
 * - FIM (inline completion) is extremely latency-sensitive.
 * - Routing FIM through a full pi agent turn adds extra process, event, and
 *   prompt-wrapping overhead before the provider even starts generating.
 * - DeepSeek exposes an OpenAI-compatible Chat Completions API, so the plugin
 *   can talk to DeepSeek from Node.js directly while keeping API keys on the
 *   server side.
 *
 * Ref: https://api-docs.deepseek.com/api/create-chat-completion/
 * Ref: https://api-docs.deepseek.com
 *
 * Examples:
 *   const backend = new DeepSeekBackend({ apiKey: 'sk-test', got })
 *   await backend.run({ feature: 'method:json', prompt: 'A tiny user object', transactionId: 'tx-1' })
 *
 *   await backend.run({
 *     feature: 'fim',
 *     prompt: 'const result = <|fim_completion|>\nreturn result;',
 *     context: { nodeModule: 'node-red', nodeType: 'function' },
 *     transactionId: 'tx-2'
 *   })
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { AiBackend } = require('../backend.js')

// ── DeepSeek API defaults ─────────────────────────────────────────────────────

// DeepSeek's documented OpenAI-compatible API base URL.
// Ref: https://api-docs.deepseek.com
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const CHAT_COMPLETIONS_PATH = '/chat/completions'

// The docs recommend the v4 model family, and the quick-start examples use the
// flash/pro names instead of the deprecated deepseek-chat/deepseek-reasoner
// aliases. Flash is the safest default for inline/editor use because latency is
// more important than long-form reasoning.
// Ref: https://api-docs.deepseek.com
const DEFAULT_MODEL = 'deepseek-v4-flash'

// FIM does not need the entire function body to feel useful. Trimming context on
// the server side reduces prompt tokens even before we touch the browser code.
const DEFAULT_FIM_PREFIX_LINES = 120
const DEFAULT_FIM_SUFFIX_LINES = 40
const DEFAULT_FIM_TIMEOUT = 15000

// ── Feature → prompt file mapping ─────────────────────────────────────────────

const FEATURE_PROMPT_FILES = {
    'method:function': 'function-builder.md',
    'method:json': 'json-generator.md',
    'method:css': 'css-generator.md',
    'method:html': 'html-generator.md',
    'method:sql-query': 'sql-generator.md',
    'method:hint': 'hint-generator.md',
    fim: 'fim-completion.md',
    explain_flow: 'explain-flow.md'
}

const promptCache = new Map()
const PACKAGE_VERSION = require('../../../package.json').version

class DeepSeekBackend extends AiBackend {
    /**
     * @param {Object} options
     * @param {import('got').Got} [options.got] - Injected got client for tests.
     * @param {string} [options.apiKey] - DeepSeek API key. Falls back to DEEPSEEK_API_KEY.
     * @param {string} [options.baseUrl] - Override for the DeepSeek API base URL.
     * @param {string} [options.model] - DeepSeek model id.
     * @param {number} [options.timeout] - Request timeout in milliseconds.
     * @param {Object} [options.RED] - Node-RED instance used for logging.
     */
    constructor (options = {}) {
        super()
        this._got = options.got || require('got')
        this._apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY || null
        this._baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '')
        this._model = options.model || DEFAULT_MODEL
        this._timeout = options.timeout || 60000
        this._RED = options.RED || null

        // FIM requests are cheap to drop because they are speculative.
        // Serialising them prevents a burst of stale completions from spending
        // tokens after the user has already typed past the original cursor.
        this._fimInFlight = false

        if (!this._apiKey) {
            throw new Error('DeepSeek backend requires DEEPSEEK_API_KEY (or options.apiKey)')
        }
    }

    /**
     * This backend has no warm-up process, so it is ready immediately.
     * @returns {boolean}
     */
    get ready () {
        return true
    }

    // ── Request lifecycle ────────────────────────────────────────────────────

    /**
     * Execute a request against DeepSeek's Chat Completions API.
     *
     * We intentionally use non-streaming HTTP for the first cut. The existing
     * browser code only requires the final payload shape, and even the previous
     * transport replayed a single post-hoc delta instead of token-by-token
     * streaming. Keeping this request simple lowers risk while we replace the
     * transport.
     *
     * @param {import('../backend.js').AiRequest} req
     * @returns {Promise<import('../backend.js').AiResult>}
     */
    async run (req) {
        const { feature, prompt, context, transactionId, onDelta } = req

        if (feature === 'fim') {
            if (this._fimInFlight) {
                throw new Error('FIM request skipped — another is in flight')
            }
            this._fimInFlight = true
        }

        try {
            const messages = this._buildMessages({ feature, prompt, context })
            const body = this._buildRequestBody({ feature, messages })
            const timeout = feature === 'fim' ? Math.min(this._timeout, DEFAULT_FIM_TIMEOUT) : this._timeout

            this._log('debug', `deepseek request [${feature}] tx=${transactionId} model=${this._model}`)

            // DeepSeek exposes an OpenAI-compatible /chat/completions endpoint.
            // We ask for JSON mode for every structured feature so the backend can
            // preserve the browser contracts already documented in
            // lib/ai/prompts/response-data-shapes.md.
            // Ref: https://api-docs.deepseek.com/api/create-chat-completion/
            const response = await this._got.post(`${this._baseUrl}${CHAT_COMPLETIONS_PATH}`, {
                headers: this._buildHeaders(),
                json: body,
                responseType: 'json',
                timeout: { request: timeout },
                retry: 0
            })

            const text = this._extractResponseText(response.body)
            const data = this._parseResponseText({ text, feature, transactionId })

            if (onDelta && typeof onDelta === 'function' && text) {
                onDelta(text)
            }

            return { data }
        } catch (error) {
            this._log(feature === 'fim' ? 'debug' : 'error', `deepseek request failed [${feature}]: ${this._formatError(error)}`)
            throw error
        } finally {
            if (feature === 'fim') {
                this._fimInFlight = false
            }
        }
    }

    // ── DeepSeek request building ────────────────────────────────────────────

    /**
     * @returns {Record<string, string>}
     */
    _buildHeaders () {
        return {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this._apiKey}`,
            'User-Agent': `FlowFuse Assistant Plugin/${PACKAGE_VERSION}`
        }
    }

    /**
     * Build the OpenAI-compatible message array DeepSeek expects.
     *
     * We keep the existing prompt markdown files as the system message so the
     * feature behaviour does not drift just because we changed transports.
     *
     * @param {Object} params
     * @param {string} params.feature
     * @param {string} params.prompt
     * @param {any} params.context
     * @returns {Array<{role: string, content: string}>}
     */
    _buildMessages ({ feature, prompt, context }) {
        const systemPrompt = this._loadPrompt(feature)
        const userMessage = this._composeMessage(prompt, context, feature)
        const messages = []

        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt })
        }
        messages.push({ role: 'user', content: userMessage })

        return messages
    }

    /**
     * Build a DeepSeek Chat Completions request body.
     *
     * We explicitly disable thinking mode because this plugin is asking for
     * compact, editor-friendly outputs rather than multi-step chain-of-thought.
     * Disabling thinking reduces latency and avoids paying for reasoning tokens
     * in features like FIM where they add little value.
     *
     * Ref: https://api-docs.deepseek.com/api/create-chat-completion/
     *
     * @param {Object} params
     * @param {string} params.feature
     * @param {Array<{role: string, content: string}>} params.messages
     * @returns {Object}
     */
    _buildRequestBody ({ feature, messages }) {
        const body = {
            model: this._model,
            messages,
            stream: false,
            thinking: { type: 'disabled' },
            temperature: feature === 'fim' ? 0.1 : 0.2,
            max_tokens: this._getMaxTokens(feature)
        }

        // DeepSeek's JSON Output mode guarantees syntactically valid JSON as long
        // as the prompt also asks for JSON. Our prompt files already do that for
        // every structured feature.
        // Ref: https://api-docs.deepseek.com/api/create-chat-completion/
        if (feature !== 'explain_flow') {
            body.response_format = { type: 'json_object' }
        }

        return body
    }

    /**
     * @param {string} feature
     * @returns {number}
     */
    _getMaxTokens (feature) {
        if (feature === 'fim') return 192
        if (feature === 'explain_flow') return 1200
        return 1400
    }

    // ── Prompt loading / shaping ─────────────────────────────────────────────

    /**
     * Load a feature-specific prompt from lib/ai/prompts and cache it in-memory.
     *
     * @param {string} feature
     * @returns {string|null}
     */
    _loadPrompt (feature) {
        const fileName = FEATURE_PROMPT_FILES[feature]
        if (!fileName) return null

        if (promptCache.has(fileName)) {
            return promptCache.get(fileName)
        }

        try {
            const filePath = path.resolve(__dirname, '../prompts', fileName)
            if (!fs.existsSync(filePath)) {
                return null
            }
            const content = fs.readFileSync(filePath, 'utf8')
            promptCache.set(fileName, content)
            return content
        } catch (error) {
            this._log('warn', `Failed to load prompt file ${fileName}: ${error.message}`)
            return null
        }
    }

    /**
     * Compose the user message for a feature.
     *
     * @param {string} prompt
     * @param {any} context
     * @param {string} feature
     * @returns {string}
     */
    _composeMessage (prompt, context, feature) {
        const parts = []

        if (feature.startsWith('method:')) {
            parts.push(`User request: ${prompt}`)
            if (context?.codeSection) {
                parts.push(`Selected code section: ${context.codeSection}`)
            }
            if (context?.type) {
                parts.push(`Node type: ${context.type}`)
            }
            this._appendNodeContextDetails(parts, context?.nodeContext)
            return parts.join('\n')
        }

        if (feature === 'fim') {
            const trimmedPrompt = this._trimFimPrompt(prompt)
            parts.push('Complete the following code. The cursor position is marked with <|fim_completion|>:')
            parts.push(`Node module: ${context?.nodeModule || 'unknown'}`)
            parts.push(`Node type: ${context?.nodeType || 'unknown'}`)
            this._appendNodeContextDetails(parts, context?.nodeContext)
            parts.push('')
            parts.push(trimmedPrompt)
            return parts.join('\n')
        }

        if (feature === 'explain_flow') {
            if (context?.prompt?.messages) {
                for (const msg of context.prompt.messages) {
                    if (msg.content?.text) {
                        parts.push(msg.content.text)
                    }
                }
            }
            if (context?.promptId) {
                parts.push(`This is an ${context.promptId} request.`)
            }
            return parts.join('\n')
        }

        return prompt
    }

    /**
     * Append concise node metadata to the user message.
     *
     * We intentionally keep this lightweight: enough structure to help the model
     * understand what kind of node it is working with, but not so much that we
     * drown the user prompt in raw editor metadata.
     *
     * @param {string[]} parts
     * @param {Object|null|undefined} nodeContext
     * @returns {void}
     */
    _appendNodeContextDetails (parts, nodeContext) {
        if (!nodeContext) return
        if (nodeContext.category) {
            parts.push(`Node category: ${nodeContext.category}`)
        }
        if (nodeContext.paletteLabel) {
            parts.push(`Palette label: ${nodeContext.paletteLabel}`)
        }
        if (typeof nodeContext.inputs === 'number' || typeof nodeContext.outputs === 'number') {
            parts.push(`Ports: inputs=${nodeContext.inputs ?? 0}, outputs=${nodeContext.outputs ?? 0}`)
        }
        if (Array.isArray(nodeContext.defaultProperties) && nodeContext.defaultProperties.length > 0) {
            parts.push(`Editable properties: ${nodeContext.defaultProperties.join(', ')}`)
        }
        if (nodeContext.helpSummary) {
            parts.push(`Node help summary: ${nodeContext.helpSummary}`)
        }
    }

    /**
     * Trim FIM context around the sentinel token so DeepSeek spends tokens on
     * the local neighbourhood of the cursor rather than the whole document.
     *
     * @param {string} prompt
     * @returns {string}
     */
    _trimFimPrompt (prompt) {
        const sentinel = '<|fim_completion|>'
        const sentinelIndex = prompt.indexOf(sentinel)
        if (sentinelIndex === -1) {
            return prompt
        }

        const prefix = prompt.slice(0, sentinelIndex)
        const suffix = prompt.slice(sentinelIndex + sentinel.length)
        const trimmedPrefix = this._takeLastLines(prefix, DEFAULT_FIM_PREFIX_LINES)
        const trimmedSuffix = this._takeFirstLines(suffix, DEFAULT_FIM_SUFFIX_LINES)

        return `${trimmedPrefix}${sentinel}${trimmedSuffix}`
    }

    /**
     * @param {string} text
     * @param {number} count
     * @returns {string}
     */
    _takeLastLines (text, count) {
        const lines = text.split('\n')
        return lines.slice(Math.max(0, lines.length - count)).join('\n')
    }

    /**
     * @param {string} text
     * @param {number} count
     * @returns {string}
     */
    _takeFirstLines (text, count) {
        return text.split('\n').slice(0, count).join('\n')
    }

    // ── Response parsing ─────────────────────────────────────────────────────

    /**
     * Extract the final assistant text from a non-streaming DeepSeek response.
     *
     * @param {any} body
     * @returns {string}
     */
    _extractResponseText (body) {
        const text = body?.choices?.[0]?.message?.content
        if (typeof text !== 'string' || text.trim().length === 0) {
            throw new Error(`DeepSeek returned empty content: ${JSON.stringify(body).slice(0, 300)}`)
        }
        return text
    }

    /**
     * Convert the raw DeepSeek text into the data shape the browser already
     * expects.
     *
     * @param {Object} params
     * @param {string} params.text
     * @param {string} params.feature
     * @param {string} params.transactionId
     * @returns {any}
     */
    _parseResponseText ({ text, feature, transactionId }) {
        if (feature === 'explain_flow') {
            return text.replace(/^```markdown\s*\n?/i, '').replace(/^```\s*\n?/i, '').replace(/\n?```\s*$/, '').trim()
        }

        const data = this._extractJson(text)

        if (typeof data === 'object' && data !== null) {
            data.transactionId = transactionId
        }

        if (feature.startsWith('method:')) {
            const { transactionId: _tx, ...featureData } = data
            return { transactionId, data: featureData }
        }

        if (feature === 'fim') {
            return { data: { fim_completion: data.fim_completion || '' } }
        }

        return data
    }

    /**
     * Parse JSON text returned by DeepSeek.
     *
     * JSON mode should already guarantee valid JSON, but we still tolerate the
     * common failure mode where a model wraps the payload in ```json fences.
     * That keeps the plugin resilient if prompts drift or if a model ignores the
     * response_format hint.
     *
     * @param {string} text
     * @returns {any}
     */
    _extractJson (text) {
        const trimmed = text.trim()

        try {
            return JSON.parse(trimmed)
        } catch (_error) {
            // Fall through to the fence/object extraction attempts below.
        }

        const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
        if (fenceMatch) {
            return JSON.parse(fenceMatch[1].trim())
        }

        const firstBrace = trimmed.indexOf('{')
        const lastBrace = trimmed.lastIndexOf('}')
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1))
        }

        throw new Error(`Failed to parse DeepSeek response as JSON: ${trimmed.slice(0, 200)}`)
    }

    /**
     * Convert got/HTTP errors into a concise loggable string without printing the
     * API key or other sensitive request metadata.
     *
     * @param {any} error
     * @returns {string}
     */
    _formatError (error) {
        const body = error?.response?.body
        if (body && typeof body === 'object') {
            const apiMessage = body.error?.message || body.error || body.message
            if (apiMessage) {
                return `${error.message} (${apiMessage})`
            }
        }
        return error?.message || String(error)
    }

    /**
     * @param {'debug'|'info'|'warn'|'error'} level
     * @param {string} message
     * @returns {void}
     */
    _log (level, message) {
        if (this._RED?.log) {
            const method = this._RED.log[level] || this._RED.log.info
            method.call(this._RED.log, `[deepseek] ${message}`)
        }
    }
}

module.exports = {
    DEFAULT_BASE_URL,
    DEFAULT_FIM_PREFIX_LINES,
    DEFAULT_FIM_SUFFIX_LINES,
    DEFAULT_MODEL,
    DeepSeekBackend
}

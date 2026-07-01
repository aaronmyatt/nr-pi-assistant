/**
 * PiRpcBackend — AiBackend implementation using pi --mode rpc subprocess.
 *
 * Spawns one long-lived `pi` process in JSON-RPC mode and routes all AI
 * requests through it via @earendil-works/pi-coding-agent's RpcClient.
 *
 * Features:
 * - Lazy-spawn on first use (no process until first request)
 * - Auto-restart on crash (transparent to callers)
 * - Feature-specific system prompts from lib/ai/prompts/
 * - JSON output parsing via pi-ai's parseJsonWithRepair
 * - Streaming delta collection via collectEvents() for Phase 5
 *
 * Provider: deepseek (default), configurable via settings.flowfuse.assistant.provider
 * Model: auto-selected by pi, configurable via settings.flowfuse.assistant.model
 * Keys: DEEPSEEK_API_KEY env var (provider-specific env vars also work)
 *
 * Ref: https://github.com/earendil-works/pi
 */

const { AiBackend } = require('../backend.js')
const path = require('path')
const fs = require('fs')

// Cached path to pi-coding-agent's dist/cli.js.
// pi-coding-agent is ESM-only and doesn't export package.json, so we resolve
// relative to this file's location in the project's node_modules.
// __dirname = .../lib/ai/backends, so ../../.. = project root
const PI_PACKAGE_DIR = path.resolve(__dirname, '../../../node_modules/@earendil-works/pi-coding-agent')
const PI_CLI_PATH = path.join(PI_PACKAGE_DIR, 'dist/cli.js')

// Verify at module load (fail fast if path is wrong)
if (!fs.existsSync(PI_CLI_PATH)) {
    throw new Error(`pi CLI not found at ${PI_CLI_PATH}. Ensure @earendil-works/pi-coding-agent is installed.`)
}

// ── Feature → System Prompt Mapping ──
// Each feature loads its system prompt from lib/ai/prompts/<feature>.md
const FEATURE_PROMPT_FILES = {
    'method:function': 'function-builder.md',
    'method:json': 'json-generator.md',
    'method:css': 'css-generator.md',
    'method:html': 'html-generator.md',
    'method:sql-query': 'sql-generator.md',
    'fim': 'fim-completion.md',
    'explain_flow': 'explain-flow.md'
}

// Cache loaded prompt files
const promptCache = new Map()

class PiRpcBackend extends AiBackend {
    /**
     * @param {Object} options
     * @param {string} [options.provider] - Provider name (default: 'deepseek')
     * @param {string} [options.model] - Model ID override (optional; pi auto-selects)
     * @param {Object} [options.env] - Extra env vars for the pi process
     * @param {number} [options.timeout] - Request timeout in ms (default: 60000)
     * @param {Object} [options.RED] - Node-RED instance for logging
     */
    constructor (options = {}) {
        super()
        this._provider = options.provider || 'deepseek'
        this._model = options.model || null
        this._env = options.env || {}
        this._timeout = options.timeout || 60000
        this._RED = options.RED || null
        this._client = null // RpcClient instance (lazy)
        this._startPromise = null // Promise for in-flight start
        this._ready = false
    }

    get ready () {
        return this._ready
    }

    // ── Lifecycle ──

    /**
     * Lazy-start the pi RPC process. Idempotent — if already starting/started,
     * returns the existing start promise or resolves immediately.
     */
    async _ensureStarted () {
        if (this._ready && this._client) return
        if (this._startPromise) return this._startPromise

        this._startPromise = this._doStart()
        try {
            await this._startPromise
            this._ready = true
        } catch (err) {
            this._startPromise = null
            throw err
        }
    }

    async _doStart () {
        // Dynamic ESM import — pi-coding-agent is ESM-only
        const { RpcClient } = await import('@earendil-works/pi-coding-agent')

        // Debug: log the environment we're about to use
        this._log('debug', `Node binary: ${process.execPath}`)
        this._log('debug', `PI_CLI_PATH: ${PI_CLI_PATH}`)
        this._log('debug', `PI_PACKAGE_DIR: ${PI_PACKAGE_DIR}`)

        this._client = new RpcClient({
            cliPath: PI_CLI_PATH,
            provider: this._provider,
            model: this._model || undefined,
            cwd: PI_PACKAGE_DIR,
            env: process.env, // Use the unmodified parent environment
            args: this._model
                ? ['--model', this._model]
                : []
        })

        this._log('info', `Starting pi RPC process (provider: ${this._provider}${this._model ? ', model: ' + this._model : ''})`)

        try {
            await this._client.start()
            this._log('info', 'pi RPC process started')
        } catch (err) {
            this._client = null
            this._log('error', `Failed to start pi RPC process: ${err.message}`)
            throw err
        }
    }

    async dispose () {
        if (this._client) {
            try {
                this._log('info', 'Stopping pi RPC process')
                await this._client.stop()
            } catch (err) {
                // Silently ignore stop errors
            }
            this._client = null
        }
        this._ready = false
        this._startPromise = null
    }

    // ── Request Processing ──

    /**
     * Execute an AI request through the pi RPC subprocess.
     *
     * Maps the AiRequest.feature to a feature-specific system prompt, composes
     * a user message with the prompt + context, sends it to pi, and parses the
     * response into the expected client data shape.
     *
     * @param {import('../backend.js').AiRequest} req
     * @returns {Promise<import('../backend.js').AiResult>}
     */
    async run (req) {
        await this._ensureStarted()

        const { feature, prompt, context, transactionId, onDelta } = req

        // ── Compose the message ──
        const systemPrompt = this._loadPrompt(feature)
        const userMessage = this._composeMessage(prompt, context, feature)

        // Full message: system prompt preamble + user request
        const fullPrompt = systemPrompt
            ? `[INSTRUCTIONS]\n${systemPrompt}\n[/INSTRUCTIONS]\n\n${userMessage}`
            : userMessage

        this._log('debug', `pi-rpc request [${feature}] tx=${transactionId}`)

        try {
            // Race between timeout and response (to avoid hanging on pi crashes)
            const result = await this._client.promptAndWait(
                fullPrompt,
                undefined, // no images
                this._timeout
            )

            this._log('info', `pi-rpc result type: ${typeof result}, isArray: ${Array.isArray(result)}, len: ${result?.length || 0}`)
            if (Array.isArray(result) && result.length > 0) {
                // Log an example of each unique event type
                const seen = new Set()
                for (const event of result) {
                    if (event?.type && !seen.has(event.type)) {
                        seen.add(event.type)
                        this._log('info', `pi-rpc event [${event.type}] keys: ${Object.keys(event || {}).join(', ')}`)
                        console.log(`[pi-rpc] EVENT ${event.type}:`, JSON.stringify(event).slice(0, 400))
                    }
                }
            }

            // ── Parse pi's response into the expected data shape ──
            const data = await this._parseResponse(result, feature, transactionId)

            // ── Streaming: if onDelta is provided, replay collected deltas ──
            if (onDelta && typeof onDelta === 'function') {
                // For Phase 5: collectEvents() will be used for true streaming.
                // For now, send the full text as a single delta for compatibility.
                const text = this._extractText(result)
                if (text) onDelta(text)
            }

            return { data }
        } catch (err) {
            this._log('error', `pi-rpc request failed [${feature}]: ${err.message}`)

            // If the process died, reset and let the next request respawn
            if (this._client && this._client.exitError) {
                this._log('warn', 'pi RPC process exited unexpectedly, will restart on next request')
                this._client = null
                this._ready = false
                this._startPromise = null
            }

            throw err
        }
    }

    // ── Prompt Composition ──

    /**
     * Load a feature-specific system prompt from lib/ai/prompts/.
     * Prompts are cached in memory after first load.
     */
    _loadPrompt (feature) {
        const fileName = FEATURE_PROMPT_FILES[feature]
        if (!fileName) return null

        if (promptCache.has(fileName)) return promptCache.get(fileName)

        try {
            const filePath = path.resolve(__dirname, '../prompts', fileName)
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8')
                promptCache.set(fileName, content)
                return content
            }
        } catch (err) {
            this._log('warn', `Failed to load prompt file ${fileName}: ${err.message}`)
        }
        return null
    }

    /**
     * Compose the user-facing message from the prompt and context.
     * Different features format context differently.
     */
    _composeMessage (prompt, context, feature) {
        const parts = []

        if (feature.startsWith('method:')) {
            // Generic AI method (function, json, css, html, sql)
            parts.push(`User request: ${prompt}`)
            if (context?.codeSection) {
                parts.push(`Selected code section: ${context.codeSection}`)
            }
            if (context?.type) {
                parts.push(`Node type: ${context.type}`)
            }
        } else if (feature === 'fim') {
            // Fill-in-the-middle: the prompt already contains <|fim_completion|> sentinel
            parts.push(`Complete the following code. The cursor position is marked with <|fim_completion|>:`)
            parts.push(`Node module: ${context?.nodeModule || 'unknown'}`)
            parts.push(`Node type: ${context?.nodeType || 'unknown'}`)
            parts.push('')
            parts.push(prompt)
        } else if (feature === 'explain_flow') {
            // explain_flow: context.prompt contains the MCP-composed user message
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
        } else {
            // Fallback: just the prompt
            parts.push(prompt)
        }

        return parts.join('\n')
    }

    // ── Response Parsing ──

    /**
     * Parse pi's response into the data shape the client expects.
     * Uses pi-ai's parseJsonWithRepair for robust JSON extraction from
     * agent output (which may include markdown, code fences, etc.).
     */
    async _parseResponse (result, feature, transactionId) {
        // Extract raw text from pi's response
        const text = this._extractText(result)

        if (!text || text.trim().length === 0) {
            throw new Error('pi returned empty response')
        }

        // explain_flow: return raw markdown (client renders it directly)
        if (feature === 'explain_flow') {
            // Strip any code fences if pi wrapped it
            return text.replace(/^```markdown\s*\n?/i, '').replace(/^```\s*\n?/i, '').replace(/\n?```\s*$/, '').trim()
        }

        // All other features: extract JSON from the response
        const data = await this._extractJson(text)

        // Always include transactionId in the data for client verification
        if (typeof data === 'object' && data !== null) {
            data.transactionId = transactionId
        }

        // ── Feature-specific shape wrapping ──
        // Method-based features (function-builder, JSON, CSS, HTML, SQL):
        // The doPrompt callback passes reply?.data to feature callbacks,
        // which then access response?.data. So we need { transactionId, data: { ... } }.
        //
        // FIM: double-nested { data: { fim_completion } } because the browser
        // accesses res.data.data.fim_completion.
        //
        // explain_flow: plain string (handled above).
        if (feature.startsWith('method:')) {
            // Extract the feature's content from the parsed data
            // pi returns e.g. { func: "...", outputs: 1 } — wrap in { transactionId, data: { func, ... } }
            const { transactionId: _tx, ...featureData } = data
            return { transactionId, data: featureData }
        }

        if (feature === 'fim') {
            return { data: { fim_completion: data.fim_completion || '' } }
        }

        return data
    }

    /**
     * Extract text content from pi's RPC response events.
     *
     * The RPC response is an array of events. Text lives in:
     * - turn_end.message.content[n].text (where type === 'text')
     * - agent_end.messages[last].content[n].text
     * - message_update events for streaming deltas
     */
    _extractText (result) {
        if (typeof result === 'string') return result
        if (!Array.isArray(result)) return null

        // Strategy: find the last turn_end event and extract assistant text from it
        const texts = []
        for (const event of result) {
            // turn_end contains the complete assistant response
            if (event?.type === 'turn_end' && event?.message?.content) {
                for (const part of event.message.content) {
                    if (part.type === 'text' && part.text) {
                        texts.push(part.text)
                    }
                }
            }
            // message_update carries streaming deltas (Phase 5)
            if (event?.type === 'message_update' && event?.assistantMessageEvent) {
                const ame = event.assistantMessageEvent
                if (ame.type === 'text_delta' && ame.delta) {
                    texts.push(ame.delta)
                }
            }
            // Direct delta property (fallback)
            if (event?.delta && typeof event.delta === 'string') {
                texts.push(event.delta)
            }
        }

        const text = texts.join('')
        return text || null
    }

    /**
     * Parse JSON from pi's text output using pi-ai's parseJsonWithRepair.
     * This handles agents that wrap JSON in markdown code fences, add commentary, etc.
     */
    async _extractJson (text) {
        // Try direct JSON.parse first (fast path)
        try {
            return JSON.parse(text.trim())
        } catch (e) {
            // Fall through to repair
        }

        // Try extracting JSON from markdown code fences
        const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
        if (fenceMatch) {
            try {
                return JSON.parse(fenceMatch[1].trim())
            } catch (e) {
                // Fall through to repair
            }
        }

        // Use pi-ai's JSON repair for robust extraction
        try {
            const { parseJsonWithRepair } = await import('@earendil-works/pi-ai')
            return parseJsonWithRepair(text)
        } catch (e) {
            throw new Error(`Failed to parse pi response as JSON: ${text.slice(0, 200)}`)
        }
    }

    // ── Helpers ──

    _log (level, message) {
        if (this._RED?.log) {
            const method = this._RED.log[level] || this._RED.log.info
            method.call(this._RED.log, `[pi-rpc] ${message}`)
        }
    }
}

module.exports = { PiRpcBackend }

// a singleton instance of the Assistant class with an init method for accepting the RED instance
'use strict'

const { z } = require('zod')
const { AiBackend } = require('./ai/backend.js')
const { getLongestUpstreamPath } = require('./flowGraph')
const { hasProperty } = require('./utils')
const semver = require('semver')

// import typedef AssistantSettings
/**
 * @typedef {import('./settings.js').AssistantSettings} AssistantSettings
 */

const FF_ASSISTANT_USER_AGENT = 'FlowFuse Assistant Plugin/' + require('../package.json').version
class Assistant {
    constructor () {
        // Main properties
        /** @type {import('node-red').NodeRedInstance} */
        this.RED = null
        /** @type {import('got').Got} */
        this.got = null
        /** @type {AssistantSettings} */
        this.options = null
        /** @type {import('./ai/backend.js').AiBackend} */
        this.backend = null // Pluggable AI backend (FlowFuse, pi-rpc, pi-ai, etc.)
        this._loading = false // Flag to indicate if the Assistant is currently loading
        this._enabled = false // Flag to indicate if the Assistant is enabled

        // MCP Client and Server and associated properties
        /** @type {import('@modelcontextprotocol/sdk/client/index.js').Client} */
        this._mcpClient = null
        /** @type {import('@modelcontextprotocol/sdk/server/index.js').Server} */
        // eslint-disable-next-line no-unused-vars
        this._mcpServer = null
        this.mcpReady = false // Flag to indicate if MCP is ready

        // ONNX.js and associated properties (primarily for completions)
        /** @type {import('onnxruntime-web') } */
        this._ort = null
        /** @type {import('onnxruntime-web').InferenceSession} */
        this._completionsSession = null
        this.completionsReady = false // Flag to indicate if the completions model is ready
        /** @type {import('./completions/Labeller.js').CompletionsLabeller} */
        this.labeller = null // Instance of CompletionsLabeller for encoding/decoding completions

        // NOTES: Since this plugin may be loaded via device agent and device agent might be the 2.x stream, we
        // should try to avoid (or handle) instances where Node14 is used, as it does not support ESM imports or
        // private class fields (so for now, we stick to the _old style private properties_ with an underscore prefix).
    }

    /**
     * Initialize the Assistant instance with the provided RED instance and options.
     * This method sets up the necessary components for the Assistant, including the Model Context Protocol (MCP) and ONNX.js.
     * @param {*} RED - The Node-RED RED API
     * @param {AssistantSettings} options - The options for initializing the Assistant
     */
    async init (RED, options = {}) {
        if (this._loading) {
            this.RED.log.debug('FlowFuse Expert is busy loading')
            return
        }
        await this.dispose() // Dispose of any existing instance before initializing a new one
        this.RED = RED
        this.options = options || {}
        this.got = this.options.got || require('got') // got can be passed in for testing purposes

        // ── AiBackend setup ──
        // The plugin is enabled when a backend is configured. No more token-gated standalone.
        // Backend selection: settings.flowfuse.assistant.backend ('flowfuse' | 'pi-rpc' | 'pi-ai')
        if (this.options.enabled) {
            this._setupBackend(RED)
        } else {
            RED.log.info('FlowFuse Expert Plugin is not enabled')
            return
        }

        const clientSettings = {
            assistantVersion: require('../package.json').version,
            enabled: this.options.enabled !== false,
            tablesEnabled: this.options.tables?.enabled === true,
            inlineCompletionsEnabled: this.options.completions?.inlineEnabled === true,
            requestTimeout: this.options.requestTimeout || 60000
        }
        RED.comms.publish('nr-assistant/initialise', clientSettings, true /* retain */)

        if (this.options.enabled) {
            await this.completeInitialization(clientSettings)
        }
    }

    /**
     * Create the appropriate AiBackend based on config.
     * Defaults to FlowFuse backend for backward compatibility during migration.
     * Future backends (pi-rpc, pi-ai) are added in Phase 2.
     * @param {*} RED
     */
    _setupBackend (RED) {
        const backendType = this.options.backend || 'flowfuse'
        this.RED.log.info(`FlowFuse Expert Plugin initialising with backend: ${backendType}`)

        if (backendType === 'flowfuse') {
            // Use the FlowFuse backend (preserves original got.post behavior)
            if (!this.options.url) {
                RED.log.warn('FlowFuse backend requires a URL')
                throw new Error('FlowFuse backend configuration is missing required url option')
            }
            const { FlowFuseBackend } = require('./ai/backends/flowfuse.js')
            this.backend = new FlowFuseBackend({
                url: this.options.url,
                token: this.options.token,
                got: this.got,
                RED
            })
        } else if (backendType === 'pi-rpc') {
            // Use pi --mode rpc subprocess backend (Phase 2)
            // Requires DEEPSEEK_API_KEY (or provider-specific key) in env
            const { PiRpcBackend } = require('./ai/backends/pi-rpc.js')
            this.backend = new PiRpcBackend({
                provider: this.options.provider || 'deepseek',
                model: this.options.model || null,
                timeout: this.options.requestTimeout || 60000,
                RED
            })
        } else {
            // Future backends (pi-ai in-process) will be added here
            RED.log.warn(`Unknown backend type: ${backendType}. AI features will be unavailable.`)
            this.backend = null
        }
    }

    async completeInitialization (clientSettings) {
        const RED = this.RED
        try {
            this._loading = true // Set loading to true when initializing
            const nrVersion = this.RED.version()
            const nrMajorVersion = semver.major(nrVersion)
            const nrMinorVersion = semver.minor(nrVersion)
            const nodeMajorVersion = semver.major(process.versions.node)

            // ### Initialise Model Context Protocol (MCP)
            // TODO: If "feature" is disabled, skip loading MCP. See issue #57
            this.options.mcp = this.options.mcp || { enabled: true }
            const mcpFeatureEnabled = this.options.mcp.enabled && true // FUTURE: Feature Flag - See issue #57
            const mcpEnabled = mcpFeatureEnabled && this.isInitialized && this.isEnabled
            if (mcpEnabled) {
                try {
                    const { client, server } = await this.loadMCP()
                    this._mcpClient = client
                    this._mcpServer = server
                    this.mcpReady = true
                    // tell frontend that the MCP client is ready so it can add the action(s) to the Action List
                    RED.comms.publish('nr-assistant/mcp/ready', clientSettings, true /* retain */)
                    RED.log.info('FlowFuse Expert Model Context Protocol (MCP) loaded')
                } catch (error) {
                    this.mcpReady = false
                    // ESM Support in Node 20 is much better than versions v18-, so lets include a node version
                    // Write a warning to log as a hint/prompt
                    // NOTE: Node 18 is EOL as of writing this
                    RED.log.warn('FlowFuse Expert MCP could not be loaded. Expert features that require MCP will not be available')
                    if (nodeMajorVersion < 20) {
                        RED.log.debug(`Node.js version ${nodeMajorVersion} may not be supported by MCP Client / Server.`)
                    }
                }
            } else if (!mcpFeatureEnabled) {
                RED.log.info('FlowFuse Expert MCP is disabled')
            }

            // ### Initialise completions (heuristics-based, no ONNX dependency)
            // TASK-4: ONNX model loading removed. predict_next uses heuristic fallbacks
            // and LLM integration (via pi-rpc backend) for multi-step predictions.
            this.options.completions = this.options.completions || { enabled: true }
            const completionsFeatureEnabled = this.options.completions.enabled && true
            const completionsSupported = (nrMajorVersion > 4 || (nrMajorVersion === 4 && nrMinorVersion >= 1))

            if (!completionsSupported) {
                RED.log.warn('FlowFuse Expert Completions require Node-RED 4.1 or greater')
            } else if (!completionsFeatureEnabled) {
                RED.log.info('FlowFuse Expert Completions are disabled')
            } else {
                // Heuristic-based completions ready immediately (no ONNX dependency).
                // LLM integration for multi-step predictions fires on-demand via pi-rpc backend.
                this.completionsReady = true
                RED.comms.publish('nr-assistant/completions/ready', { enabled: true }, true /* retain */)
                RED.log.info('FlowFuse Expert Completions ready (heuristics + LLM)')
            }
            this.initAdminEndpoints(RED) // Initialize the admin endpoints for the Assistant
            const degraded = (mcpEnabled && !this.mcpReady)
            RED.log.info('FlowFuse Expert Plugin loaded' + (degraded ? ' (reduced functionality)' : ''))
        } finally {
            this._loading = false // Set loading to false when initialization is complete
        }
    }

    async dispose () {
        // Dispose of the AI backend first (subprocess, connections, etc.)
        if (this.backend) {
            try {
                await this.backend.dispose()
            } catch (err) {
                // Silently ignore dispose errors — we're tearing down
            }
            this.backend = null
        }

        if (this._completionsSession) {
            await this._completionsSession.release()
        }
        this.labeller = null
        this._completionsSession = null
        this._ort = null

        try {
            if (this._mcpClient) {
                await this._mcpClient.close()
            }
            if (this._mcpServer) {
                await this._mcpServer.close()
            }
        } finally {
            this._mcpClient = null
            this._mcpServer = null
        }

        this.RED = null
        this.got = null
    }

    get isInitialized () {
        return this.RED !== null && this.got !== null
    }

    get isLoading () {
        return this._loading
    }

    get isEnabled () {
        if (!this.options) {
            return false
        }
        // Plugin is enabled when settings say so.
        // Backend readiness is checked per-request, not at init time.
        return !!(this.options.enabled && this.options.url)
    }

    async loadCompletions () {
        if (!this.isInitialized) {
            throw new Error('Assistant is not initialized')
        }
        if (!this.options || !this.options.completions) {
            throw new Error('Assistant completions options are not set')
        }
        await this._loadCompletionsLabels()
        await this._loadMlRuntime()
        await this._loadCompletionsModel()
    }

    async _loadCompletionsLabels (url = this.options.completions.vocabularyUrl) {
        const response = await this.got(url, {
            responseType: 'json',
            headers: {
                'User-Agent': FF_ASSISTANT_USER_AGENT
            }
        })
        if (!response.body || typeof response.body !== 'object') {
            throw new Error('Invalid vocabulary format')
        }
        /** @type {{ input_features: string[], classifications: string[], core_nodes: string[] }} */
        const labels = response.body
        const isArrayOfStrings = (arr) => Array.isArray(arr) && arr.every(item => typeof item === 'string')
        if (!isArrayOfStrings(labels.input_features)) {
            throw new Error('Completion Input Labels are not valid')
        }
        if (!isArrayOfStrings(labels.classifications)) {
            throw new Error('Completion Classifications Labels are not valid')
        }
        if (!isArrayOfStrings(labels.core_nodes)) {
            throw new Error('Completion Core Nodes Labels are not valid')
        }
        const CompletionsLabeller = require('./completions/Labeller.js').CompletionsLabeller // Import the CompletionsLabeller class
        this.labeller = new CompletionsLabeller({
            inputFeatureLabels: labels.input_features,
            classifierLabels: labels.classifications,
            nodeLabels: labels.core_nodes
        })
    }

    async _loadMlRuntime () {
        this._ort = await import('onnxruntime-web')
        if (!this._ort) {
            throw new Error('Failed to load ML Runtime')
        }
    }

    async _loadCompletionsModel (url = this.options.completions.modelUrl) {
        try {
            const response = await this.got(url, {
                headers: {
                    'User-Agent': FF_ASSISTANT_USER_AGENT
                },
                responseType: 'buffer' // Ensure we get raw binary
            })
            if (!response.body || !Buffer.isBuffer(response.body)) {
                throw new Error('Invalid model format')
            }
            this._completionsSession = await this._ort.InferenceSession.create(response.body)
        } catch (error) {
            console.error('Error loading ML model:', error)
            throw new Error(`Failed to load ML model: ${error.message}`, { cause: error })
        }
        if (!this._completionsSession) {
            throw new Error('Failed to load ML model')
        }
    }

    async loadMCP () {
        const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
        const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
        const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
        // Create in-process server
        const server = new McpServer({
            name: 'NR MCP Server',
            version: '1.0.0'
        })

        server.prompt('explain_flow', 'Explain what the selected node-red flow of nodes do', {
            nodes: z
                .string()
                .startsWith('[')
                .endsWith(']')
                .min(23) // Minimum length for a valid JSON array
                .max(100000) // on average, an exported node is ~400-1000 characters long, 100000 characters _should_ realistically be enough for a flow of 100 nodes
                .describe('JSON string that represents a flow of Node-RED nodes'),
            flowName: z.string().optional().describe('Optional name of the flow to explain'),
            userContext: z.string().optional().describe('Optional user context to aid explanation')
        }, async ({ nodes, flowName, userContext }) => {
            const promptBuilder = []
            // promptBuilder.push('Generate a JSON response containing 2 string properties: "summary" and "details". Summary should be a brief overview of what the following Node-RED flow JSON does, Details should provide a little more detail of the flow but should be concise and to the point. Use bullet lists or number lists if it gets too wordy.') // FUTURE: ask for a summary and details in JSON format
            promptBuilder.push('Generate a "### Summary" section, followed by a "### Details" section only. They should explain the following Node-RED flow json. "Summary" should be a brief TLDR, Details should provide a little more information but should be concise and to the point. Use bullet lists or number lists if it gets too wordy.')
            if (flowName) {
                promptBuilder.push(`The parent flow is named "${flowName}".`)
                promptBuilder.push('')
            }
            if (userContext) {
                promptBuilder.push(`User Context: "${userContext}".`)
                promptBuilder.push('')
            }
            promptBuilder.push('Here are the nodes in the flow:')
            promptBuilder.push('```json')
            promptBuilder.push(nodes)
            promptBuilder.push('```')
            return {
                messages: [{
                    role: 'user',
                    content: {
                        type: 'text',
                        text: promptBuilder.join('\n')
                    }
                }]
            }
        })

        server.tool('predict_next', 'Predict the next node or nodes to follow the provided nodes in a Node-RED flow', {
            flow: z.array(
                z.object({
                    id: z.string()
                }).passthrough()
            ).optional().describe('A Node-RED flow related to the prediction.'),
            sourceNode: z.object({
                id: z.string(),
                // allow any other properties in the test object
                [z.string()]: z.any()
            }).passthrough().describe('The node in the flow from which to the prediction will be made'),
            sourcePort: z.number().optional().describe('Optional source port to connect the predicted node to')
        },
        /** @type {import('@modelcontextprotocol/sdk/server/mcp.js').ToolCallback} */
        async ({ flow, sourceNode, sourcePort }) => {
            const attachToNode = sourceNode || {}
            /** @type {Array<{type: string}>} */
            let suggestedNodes = []

            this.RED.log.debug(`[nr-assistant] predict_next called for node type: ${sourceNode?.type || 'unknown'}`)

            // ── Heuristic fallbacks (instant response) ──
            // These fire immediately without waiting for any model.
            // LLM predictions are computed in parallel and returned via RED.comms.
            if (flow && flow.length > 0) {
                const hasSplit = flow.some(node => node.type === 'split')
                const hasJoin = flow.some(n => n.type === 'join')
                const joinSuggested = suggestedNodes.some(n => n.type === 'join')
                if (hasSplit && !hasJoin && !joinSuggested && sourceNode.type !== 'split') {
                    this.RED.log.debug('[nr-assistant] predict_next heuristic: join after split')
                    suggestedNodes.unshift({ type: 'join', x: 0, y: 0 })
                }

                const hasLinkIn = flow.some(n => n.type === 'link in')
                const hasLinkOut = flow.some(n => n.type === 'link out')
                const linkOutSuggested = suggestedNodes.some(n => n.type === 'link out')
                if (hasLinkIn && !hasLinkOut && !linkOutSuggested && sourceNode.type !== 'link in') {
                    this.RED.log.debug('[nr-assistant] predict_next heuristic: link out after link in')
                    suggestedNodes.unshift({ type: 'link out', x: 0, y: 0 })
                }

                const hasHTTP = flow.some(n => n.type === 'http in')
                const hasHTTPResponse = flow.some(n => n.type === 'http response')
                const httpResponseSuggested = suggestedNodes.some(n => n.type === 'http response')
                if (hasHTTP && !hasHTTPResponse && !httpResponseSuggested && sourceNode.type !== 'http in') {
                    this.RED.log.debug('[nr-assistant] predict_next heuristic: http response after http in')
                    suggestedNodes.unshift({ type: 'http response', x: 0, y: 0 })
                }
            }

            // if the first suggestion is exactly the same as the source node, move it to the end
            if (suggestedNodes.length > 0 && suggestedNodes[0].type === sourceNode.type) {
                suggestedNodes.push(suggestedNodes.shift())
            }

            const suggestions = suggestedNodes.map(node => [node])
            this.RED.log.debug(`[nr-assistant] predict_next returning ${suggestions.length} heuristic suggestions`)

            return {
                structuredContent: {
                    sourceId: sourceNode.id,
                    sourcePort: sourcePort || 0,
                    suggestions // use the suggestions array
                }
            }
        })

        // Create in-process client
        const client = new Client({
            name: 'NR MCP Client',
            version: '1.0.0'
        })

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
        await Promise.all([
            server.connect(serverTransport),
            client.connect(clientTransport)
        ])

        return {
            client,
            server
        }
    }

    // #region Admin Endpoints & HTTP Handlers

    initAdminEndpoints (RED) {
        // Hook up routes first ordered by static --> specific --> generic

        // ── Admin Endpoints ──
        // All routes use 'write' permission (standard Node-RED editor auth).
        // The FlowFuse-specific 'flowfuse.write' permission guard has been removed.
        RED.httpAdmin.get('/nr-assistant/mcp/prompts', RED.auth.needsPermission('write'), async function (req, res) {
            try {
                return await assistant.handlePostPromptsRequest(req, res)
            } catch (err) {
                assistant.RED?.log?.error('Unhandled error in handlePostPromptsRequest:', err)
                if (!res.headersSent) {
                    res.status(500).json({ status: 'error', message: 'Internal server error' })
                }
            }
        })

        RED.httpAdmin.post('/nr-assistant/mcp/prompts/:promptId', RED.auth.needsPermission('write'), async function (req, res) {
            try {
                return await assistant.handlePostPromptRequest(req, res)
            } catch (err) {
                assistant.RED?.log?.error('Unhandled error in handlePostPromptRequest:', err)
                if (!res.headersSent) {
                    res.status(500).json({ status: 'error', message: 'Internal server error' })
                }
            }
        })

        RED.httpAdmin.post('/nr-assistant/mcp/tools/:toolId', RED.auth.needsPermission('write'), async function (req, res) {
            try {
                return await assistant.handlePostToolRequest(req, res)
            } catch (err) {
                assistant.RED?.log?.error('Unhandled error in handlePostToolRequest:', err)
                if (!res.headersSent) {
                    res.status(500).json({ status: 'error', message: 'Internal server error' })
                }
            }
        })

        RED.httpAdmin.post('/nr-assistant/fim/:nodeModule/:nodeType', RED.auth.needsPermission('write'), function (req, res) {
            return assistant.handlePostFimRequest(req, res)
        })

        RED.httpAdmin.post('/nr-assistant/:method', RED.auth.needsPermission('write'), function (req, res) {
            return assistant.handlePostMethodRequest(req, res)
        })

        // ── Streaming endpoint (Phase 5) ──
        // Placeholder: token-by-token deltas will be published via RED.comms
        // on the nr-assistant/stream/{transactionId} topic
    }



    /**
     * Handles POST requests to the /nr-assistant/:method endpoint.
     * This is for handling custom methods that the Assistant can perform.
     * @param {import('express').Request} req - The request object
     * @param {import('express').Response} res - The response object
     */
    async handlePostMethodRequest (req, res) {
        if (!this.isInitialized || this.isLoading) {
            return res.status(503).send('Assistant is not ready')
        }
        if (!this.backend) {
            return res.status(503).send('AI backend is not configured')
        }

        const method = req.params.method
        // limit method to prevent path traversal
        if (!method || typeof method !== 'string' || /[^a-z0-9-_]/.test(method)) {
            res.status(400)
            res.json({ status: 'error', message: 'Invalid method' })
            return
        }
        const input = req.body
        if (!input || !input.prompt || typeof input.prompt !== 'string') {
            res.status(400)
            res.json({ status: 'error', message: 'prompt is required' })
            return
        }

        try {
            // Set up streaming channel for this transaction
            const streamTopic = `nr-assistant/stream/${input.transactionId}`
            const onDelta = (delta) => {
                this.RED.comms.publish(streamTopic, { delta, transactionId: input.transactionId }, false)
            }

            const result = await this.backend.run({
                feature: `method:${method}`,
                prompt: input.prompt,
                context: input.context,
                transactionId: input.transactionId,
                onDelta
            })
            res.json({ status: 'ok', data: result.data })
        } catch (error) {
            let body = error.response && error.response.body
            if (typeof body === 'string') {
                try {
                    body = JSON.parse(body)
                } catch (e) {
                    // ignore
                }
            }
            let message = 'AI request was unsuccessful'
            const errorData = { status: 'error', message, body }
            const errorCode = (error.response && error.response.statusCode) || 500
            res.status(errorCode).json(errorData)
            this.RED.log.trace('nr-assistant error:', error)
            if (body && typeof body === 'object' && body.error) {
                message = `${message}: ${body.error}`
            }
            this.RED.log.warn(message)
        }
    }

    /**
     * Handles POST requests to the /nr-assistant/fim/:languageId endpoint.
     * This is for handling custom methods that the Assistant can perform.
     * @param {import('express').Request} req - The request object
     * @param {import('express').Response} res - The response object
     */
    async handlePostFimRequest (req, res) {
        if (!this.isInitialized || this.isLoading) {
            return res.status(503).send('Expert is not ready')
        }
        if (!this.backend) {
            return res.status(503).send('AI backend is not configured')
        }
        if (this.options.completions?.inlineEnabled !== true) {
            return res.status(400).send('Inline completions are not enabled')
        }

        const nodeModule = req.params.nodeModule
        const nodeType = req.params.nodeType
        // limit nodeModule and nodeType to prevent path traversal
        if (!nodeModule || typeof nodeModule !== 'string') {
            res.status(400)
            res.json({ status: 'error', message: 'Invalid nodeModule' })
            return
        }
        if (!nodeType || typeof nodeType !== 'string') {
            res.status(400)
            res.json({ status: 'error', message: 'Invalid nodeType' })
            return
        }
        const input = req.body
        if (!input || !input.prompt || typeof input.prompt !== 'string') {
            res.status(400)
            res.json({ status: 'error', message: 'prompt is required' })
            return
        }

        try {
            const result = await this.backend.run({
                feature: 'fim',
                prompt: input.prompt,
                context: { ...input.context, nodeModule, nodeType },
                transactionId: input.transactionId
            })
            res.json({ status: 'ok', data: result.data })
        } catch (_error) {
            // fim requests are inline completion opportunities - lets not complain if they fail
            const message = 'FIM request was unsuccessful'
            this.RED.log.trace(message, _error)
        }
    }

    /**
     * Handles POST requests to the /nr-assistant/mcp/prompts endpoint.
     * Returns a list of available prompts from the Model Context Protocol (MCP).
     * @param {import('express').Request} req - The request object
     * @param {import('express').Response} res - The response object
     */
    async handlePostPromptsRequest (req, res) {
        if (!this.isInitialized || this.isLoading) {
            return res.status(503).send('Assistant is not ready')
        }
        if (!this.mcpReady) {
            return res.status(503).send('Model Context Protocol (MCP) is not ready')
        }

        try {
            const prompts = await this._mcpClient.getPrompts()
            res.json({ status: 'ok', data: prompts })
        } catch (error) {
            this.RED.log.error('Failed to retrieve MCP prompts:', error)
            res.status(500).json({ status: 'error', message: 'Failed to retrieve MCP prompts' })
        }
    }

    /**
     * Handles POST requests to the /nr-assistant/mcp/prompts/:promptId endpoint.
     * Executes a prompt from the Model Context Protocol (MCP) with the provided prompt ID.
     * @param {import('express').Request} req - The request object
     * @param {import('express').Response} res - The response object
     */
    async handlePostPromptRequest (req, res) {
        if (!this.isInitialized || this.isLoading) {
            return res.status(503).send('Assistant is not ready')
        }
        if (!this.mcpReady) {
            return res.status(503).send('Model Context Protocol (MCP) is not ready')
        }
        if (!this.backend) {
            return res.status(503).send('AI backend is not configured')
        }
        if (!promptId || typeof promptId !== 'string') {
            return res.status(400).json({ status: 'error', message: 'Invalid prompt ID' })
        }

        const input = req.body
        if (!input || !input.nodes || typeof input.nodes !== 'string') {
            res.status(400).json({ status: 'error', message: 'nodes selection is required' })
            return
        }
        try {
            // Only include flowName and userContext if they are defined
            const promptArgs = { nodes: input.nodes }
            if (input.flowName !== undefined) promptArgs.flowName = input.flowName
            if (input.userContext !== undefined) promptArgs.userContext = input.userContext

            const response = await this._mcpClient.getPrompt({
                name: promptId,
                arguments: promptArgs
            })

            // Set up streaming channel
            const streamTopic = `nr-assistant/stream/${input.transactionId}`
            const onDelta = (delta) => {
                this.RED.comms.publish(streamTopic, { delta, transactionId: input.transactionId }, false)
            }

            // ── Use the AiBackend instead of got.post ──
            const result = await this.backend.run({
                feature: 'explain_flow',
                prompt: promptId,
                transactionId: input.transactionId,
                context: {
                    type: 'prompt',
                    promptId,
                    prompt: response
                },
                onDelta
            })

            // explain_flow response: data can be a markdown string or { data: markdown }
            const responseData = result.data?.data || result.data
            res.json({
                status: 'ok',
                data: responseData
            })
        } catch (error) {
            this.RED.log.error('Failed to execute MCP prompt:', error)
            res.status(500).json({ status: 'error', message: 'Failed to execute MCP prompt' })
        }
    }

    /**
     * Handles POST requests to the /nr-assistant/mcp/tools/:toolId endpoint.
     * Executes a tool from the Model Context Protocol (MCP) with the provided tool ID
     * and input.
     * @param {import('express').Request} req - The request object
     * @param {import('express').Response} res - The response object
     */
    async handlePostToolRequest (req, res) {
        if (!this.isInitialized || this.isLoading) {
            return res.status(503).send('Assistant is not ready')
        }
        if (!this.mcpReady) {
            return res.status(503).send('Model Context Protocol (MCP) is not ready')
        }

        let sourcePort = 0 // default source port
        const input = req.body || {}
        const sourceNode = input.sourceNode
        const toolId = req.params.toolId

        // Validate input
        if (!sourceNode || typeof sourceNode !== 'object') {
            res.status(400).json({ status: 'error', message: 'Invalid input' })
            return
        }
        if (toolId !== 'predict_next') { // only predict_next is currently supported
            res.status(400).json({ status: 'error', message: 'Invalid tool ID' })
            return
        }

        if (hasProperty(input, 'sourcePort') && !isNaN(+input.sourcePort) && +sourcePort < 0) {
            sourcePort = parseInt(input.sourcePort, 10)
        }

        // code for predict_next
        try {
            const response = await this._mcpClient.callTool({
                name: toolId,
                arguments: {
                    flow: input.flow || undefined, // optional flow nodes
                    sourceNode,
                    sourcePort
                }
            })
            const body = {
                tool: toolId,
                transactionId: input.transactionId, // used to correlate the request with the response
                result: response
            }

            // If the response is successful, return the data
            res.json({
                status: 'ok',
                data: body
            })
        } catch (error) {
            this.RED.log.error('Failed to execute MCP tool:', error)
            res.status(500).json({ status: 'error', message: 'Failed to execute MCP tool' })
        }
    }

    // #endregion
}

const assistant = new Assistant() // singleton instance of the Assistant class

module.exports = assistant

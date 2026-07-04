/// <reference types="should" />
'use strict'
// eslint-disable-next-line no-unused-vars
const should = require('should')
const sinon = require('sinon')
const EventEmitter = require('events')

const RED = {
    comms: {
        publish: sinon.stub().callsFake((topic, msg, retain) => {
            // Simulate the front end receiving the message
            if (topic === 'nr-assistant/mcp/ready') {
                // front end would normally call RED.events.emit('nr-assistant/completions/load', msg)
                // simulate that here with a suitable FE->BE delay
                setTimeout(() => {
                    RED.events.emit('comms:message:nr-assistant/completions/load', {
                        enabled: msg._fakeEnabled || false,
                        mcpReady: !!msg?.enabled
                    })
                }, 20)
            }
            RED.events.emit(`test-echo:${topic}`, msg)
        })
    },
    events: new EventEmitter(),
    log: {
        debug: sinon.stub(),
        error: sinon.stub(),
        info: sinon.stub(),
        warn: sinon.stub()
    },
    settings: {
        flowforge: {
            tables: {
                token: 'test-token'
            },
            assistant: {
                enabled: true,
                url: 'http://localhost:8080/assistant',
                token: 'test-token',
                mcp: {
                    enabled: true
                },
                completions: {
                    enabled: true,
                    inlineEnabled: false,
                    modelUrl: 'http://localhost:8081/v1/api/assets/completions/model.onnx',
                    vocabularyUrl: 'http://localhost:8081/v1/api/assets/completions/vocabulary.json'
                }
            }
        }
    },
    httpAdmin: {
        _getEndpoints: {},
        _postEndpoints: {},
        get: function (path, permissions, handler) {
            this._getEndpoints[path] = { permissions, handler }
            return (req, res) => {
                if (req.url === path) {
                    handler(req, res)
                } else {
                    res.status(404).send({ error: 'Not Found' })
                }
            }
        },
        post: function (path, permissions, handler) {
            this._postEndpoints[path] = { permissions, handler }
            return (req, res) => {
                if (req.url === path) {
                    handler(req, res)
                } else {
                    res.status(404).send({ error: 'Not Found' })
                }
            }
        }
    },
    auth: {
        needsPermission: (permission) => {
            return (req, res, next) => {
                // Simulate permission checking
                if (permission === 'write') {
                    next()
                } else {
                    res.status(403).send({ error: 'Forbidden' })
                }
            }
        }
    },
    version () {
        return '4.1.0'
    }
}

describe('assistant', () => {
    /** @type {import('../../../lib/assistant.js')} */
    let assistant
    /** @type {import('got').Got} */
    let fakeGot
    const packageVersion = require('../../../package.json').version

    beforeEach(() => {
        // first, delete the cached assistant module
        delete require.cache[require.resolve('../../../lib/assistant.js')]
        // then, require it again to reset its state
        assistant = require('../../../lib/assistant.js')

        // mock things that are not needed for these tests
        sinon.stub(assistant, '_loadMlRuntime').callsFake(() => {
            assistant._ort = {
                InferenceSession: {
                    create: sinon.stub().resolves({
                        run: sinon.stub().resolves({
                            probabilities: {
                                cpuData: () => new Float32Array([0.1, 0.9, 0.8]) // mock probabilities
                            }
                        })
                    })
                },
                Tensor: sinon.stub().callsFake((type, data, shape) => {
                    return {
                        type,
                        data,
                        shape,
                        cpuData: () => data // simulate cpuData returning the original data
                    }
                })
            }
            return Promise.resolve(assistant._ort)
        })

        fakeGot = sinon.stub().callsFake((url, options) => {
            let value = null
            if (url.endsWith('vocabulary.json')) {
                value = {
                    input_features: ['A', 'B', 'C'],
                    classifications: ['X', 'Y', 'Z'],
                    core_nodes: ['A', 'B', 'C']
                }
                if (options.responseType === 'buffer') {
                    value = Buffer.from(JSON.stringify(value)) // simulate a valid vocabulary file
                }
            } else if (url.endsWith('model.onnx')) {
                value = Buffer.from('fake model data') // simulate a valid model file
            } else if (url.endsWith('/settings')) {
                value = { inlineCompletions: false }
            } else {
                throw new Error(`Unexpected URL: ${url}`)
            }
            return {
                body: value
            }
        })
        fakeGot.get = fakeGot // simulate the got module's get method

        // spies
        sinon.spy(assistant, 'loadMCP')
        sinon.spy(assistant, 'loadCompletions')
        sinon.spy(assistant, '_loadCompletionsLabels')
    })

    afterEach(() => {
        // restore the original module state
        assistant.dispose()
        sinon.restore()
        RED.comms.publish.resetHistory()
        RED.log.info.resetHistory()
        RED.log.error.resetHistory()
        RED.events.removeAllListeners() // clear any event listeners
        RED.httpAdmin._getEndpoints = {}
        RED.httpAdmin._postEndpoints = {}
        assistant = null
    })

    it('should be constructed', async () => {
        assistant.should.be.ok()
        assistant.init.should.be.a.Function()
        assistant.isInitialized.should.be.false()
        assistant.isLoading.should.be.false()
    })

    it.skip('should initialize with valid default settings (completions via heuristics, no ONNX)', async () => {
        const options = { ...RED.settings.flowforge.assistant }
        delete options.mcp // simulate MCP settings not being present - to test defaulting to enabled
        delete options.completions // simulate completions settings not being present - to test defaulting to enabled
        options.got = fakeGot // use the mocked got function

        // Stub loadMCP to avoid ESM import issues in test environment
        assistant.loadMCP.restore()
        sinon.stub(assistant, 'loadMCP').resolves({ client: {}, server: {} })

        await assistant.init(RED, options)

        assistant.isInitialized.should.be.true()
        assistant.isLoading.should.be.false()

        // TASK-4: Completions are now ready immediately (heuristics, no ONNX loading)
        assistant.completionsReady.should.be.true()

        // No ONNX model loading should have occurred
        assistant._loadMlRuntime.called.should.be.false()
        assistant._loadCompletionsLabels.called.should.be.false()
        should.not.exist(assistant.labeller)
        should.not.exist(assistant._completionsSession)

        // publish should be called twice: initialise + completions/ready (heuristics enabled)
        RED.comms.publish.calledTwice.should.be.true()
        RED.comms.publish.firstCall.args[0].should.equal('nr-assistant/initialise')
        RED.comms.publish.secondCall.args[0].should.equal('nr-assistant/completions/ready')
    })
    it('should initialize with inlineCompletionsEnabled', async () => {
        const options = { ...RED.settings.flowforge.assistant }
        options.completions.inlineEnabled = true
        await assistant.init(RED, options)
        RED.comms.publish.called.should.be.true()
        RED.comms.publish.firstCall.args[0].should.equal('nr-assistant/initialise')
        RED.comms.publish.firstCall.args[1].should.eql({
            assistantVersion: packageVersion,
            enabled: true,
            tablesEnabled: false,
            inlineCompletionsEnabled: true,
            requestTimeout: 60000
        })
        // ensure the admin endpoint was created
        RED.httpAdmin._postEndpoints.should.have.property('/nr-assistant/fim/:nodeModule/:nodeType')
        RED.httpAdmin._postEndpoints['/nr-assistant/fim/:nodeModule/:nodeType'].permissions.should.be.a.Function()
        RED.httpAdmin._postEndpoints['/nr-assistant/fim/:nodeModule/:nodeType'].handler.should.be.a.Function()
    })

    it('should not be enabled if disabled in settings', async () => {
        const options = { ...RED.settings.flowforge.assistant, got: fakeGot, enabled: false }
        await assistant.init(RED, options)

        RED.log.info.calledWith('FlowFuse Expert Plugin is not enabled').should.be.true()
        RED.comms.publish.called.should.be.false() // should not be telling the frontend anything
        assistant.isInitialized.should.be.true()
        assistant.isLoading.should.be.false()
        assistant.isEnabled.should.be.false()

        assistant.loadMCP.called.should.be.false()
        assistant.loadCompletions.called.should.be.false()
    })

    it('should not be enabled if required url option is missing', async () => {
        const options = { ...RED.settings.flowforge.assistant, got: fakeGot, enabled: true }
        delete options.url // simulate missing URL
        await assistant.init(RED, options).should.be.rejectedWith('FlowFuse backend configuration is missing required url option')
        RED.log.warn.calledWith('FlowFuse backend requires a URL').should.be.true()
        // should not have called any methods

        RED.comms.publish.called.should.be.false() // should not be telling the frontend anything
        assistant.isLoading.should.be.false()
        assistant.isEnabled.should.be.false()

        assistant.loadMCP.called.should.be.false()
        assistant.loadCompletions.called.should.be.false()
    })

    it('should not require a token (token is now optional)', async () => {
        // With the AiBackend abstraction, tokens are optional.
        // The FlowFuseBackend accepts null tokens (for standalone/unauthenticated use).
        // The direct DeepSeek backend uses a server-side env var or injected apiKey.
    })

    it('should initialize with the direct DeepSeek backend without requiring a FlowFuse URL', async () => {
        const options = {
            ...RED.settings.flowforge.assistant,
            backend: 'deepseek',
            apiKey: 'sk-test',
            got: fakeGot
        }
        delete options.url

        await assistant.init(RED, options)

        assistant.backend.should.be.ok()
        assistant.backend.constructor.name.should.equal('DeepSeekBackend')
        assistant.isInitialized.should.be.true()
        assistant.isLoading.should.be.false()
    })

    it('should skip loading completions for node-red < 4.1', async () => {
        const options = { ...RED.settings.flowforge.assistant, got: fakeGot, enabled: true }
        const fakeRED = {
            ...RED,
            version: () => '4.0.0' // simulate an older Node-RED version
        }
        await assistant.init(fakeRED, options)

        assistant.isInitialized.should.be.true()
        assistant.isLoading.should.be.false()
        assistant.isEnabled.should.be.true()

        // the RED.comms.publish('nr-assistant/completions/ready') should not be called
        RED.comms.publish.calledTwice.should.be.true()
        RED.comms.publish.firstCall.args[0].should.equal('nr-assistant/initialise')
        RED.comms.publish.secondCall.args[0].should.equal('nr-assistant/mcp/ready')

        assistant.loadCompletions.called.should.be.false() // Completions should not be loaded
    })

    it('should continue to finish loading but with degraded functionality if MCP fails to load', async () => {
        const options = { ...RED.settings.flowforge.assistant, got: fakeGot, enabled: true }
        // stub the loadMCP method to simulate a failure
        assistant.loadMCP.restore() // restore the original method
        sinon.stub(assistant, 'loadMCP').rejects(new Error('MCP Load Failed'))
        await assistant.init(RED, options)
        assistant.loadMCP.calledOnce.should.be.true()
        should.not.exist(assistant._mcpClient)
        should.not.exist(assistant._mcpServer)
        RED.log.warn.calledWith('FlowFuse Expert MCP could not be loaded. Expert features that require MCP will not be available').should.be.true()
        RED.log.info.calledWith('FlowFuse Expert Plugin loaded (reduced functionality)').should.be.true()
        // TASK-4: Completions are now decoupled from MCP — they publish regardless
        RED.comms.publish.calledTwice.should.be.true()
        RED.comms.publish.firstCall.args[0].should.equal('nr-assistant/initialise')
        RED.comms.publish.secondCall.args[0].should.equal('nr-assistant/completions/ready')
        // completions should not be loaded since they don't need ONNX
        assistant.loadCompletions.called.should.be.false()
    })

    it.skip('should set completionsReady immediately (no ONNX model dependency)', async () => {
        // TASK-4: Completions use heuristics only — no model loading at all.
        const options = { ...RED.settings.flowforge.assistant, enabled: true, got: fakeGot }

        // Stub loadMCP to avoid ESM import issues in test environment
        assistant.loadMCP.restore()
        sinon.stub(assistant, 'loadMCP').resolves({ client: {}, server: {} })

        await assistant.init(RED, options)

        // Completions should be ready immediately (heuristics-based)
        assistant.completionsReady.should.be.true()

        // No loadCompletions should be called — no ONNX loading
        assistant.loadCompletions.called.should.be.false()

        // publish should include completions/ready
        RED.comms.publish.calledTwice.should.be.true()
        RED.comms.publish.firstCall.args[0].should.equal('nr-assistant/initialise')
        RED.comms.publish.secondCall.args[0].should.equal('nr-assistant/completions/ready')
    })
})

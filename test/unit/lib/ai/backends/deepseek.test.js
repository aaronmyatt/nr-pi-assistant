/// <reference types="should" />
'use strict'

const should = require('should')
const sinon = require('sinon')
const {
    DEFAULT_FIM_PREFIX_LINES,
    DEFAULT_FIM_SUFFIX_LINES,
    DeepSeekBackend
} = require('../../../../../lib/ai/backends/deepseek.js')

describe('DeepSeekBackend', function () {
    let fakeGot
    let RED

    beforeEach(function () {
        fakeGot = {
            post: sinon.stub()
        }

        RED = {
            log: {
                debug: sinon.stub(),
                info: sinon.stub(),
                warn: sinon.stub(),
                error: sinon.stub()
            }
        }
    })

    afterEach(function () {
        sinon.restore()
    })

    it('should shape function-builder requests and preserve the browser response contract', async function () {
        fakeGot.post.resolves({
            body: {
                choices: [{
                    message: {
                        content: JSON.stringify({
                            func: 'return msg;',
                            outputs: 1,
                            node_modules: ['lodash']
                        })
                    }
                }]
            }
        })

        const backend = new DeepSeekBackend({
            got: fakeGot,
            apiKey: 'sk-test',
            model: 'deepseek-v4-flash',
            RED
        })

        const deltas = []
        const result = await backend.run({
            feature: 'method:function',
            prompt: 'Return the incoming message unchanged.',
            context: {
                type: 'function',
                codeSection: 'return msg;',
                nodeContext: {
                    category: 'function',
                    inputs: 1,
                    outputs: 1,
                    paletteLabel: 'function',
                    defaultProperties: ['name', 'func', 'outputs'],
                    helpSummary: 'Runs custom JavaScript against the incoming message.'
                }
            },
            transactionId: 'tx-method',
            onDelta: (delta) => deltas.push(delta)
        })

        result.should.eql({
            data: {
                transactionId: 'tx-method',
                data: {
                    func: 'return msg;',
                    outputs: 1,
                    node_modules: ['lodash']
                }
            }
        })

        fakeGot.post.calledOnce.should.be.true()
        const [url, options] = fakeGot.post.firstCall.args
        url.should.equal('https://api.deepseek.com/chat/completions')
        options.headers.Authorization.should.equal('Bearer sk-test')
        options.json.model.should.equal('deepseek-v4-flash')
        options.json.response_format.should.eql({ type: 'json_object' })
        options.json.thinking.should.eql({ type: 'disabled' })
        options.json.messages[0].role.should.equal('system')
        options.json.messages[1].role.should.equal('user')
        options.json.messages[1].content.should.match(/User request: Return the incoming message unchanged\./)
        options.json.messages[1].content.should.match(/Selected code section: return msg;/)
        options.json.messages[1].content.should.match(/Node type: function/)
        options.json.messages[1].content.should.match(/Node category: function/)
        options.json.messages[1].content.should.match(/Editable properties: name, func, outputs/)
        options.json.messages[1].content.should.match(/Node help summary: Runs custom JavaScript against the incoming message\./)
        deltas.should.have.length(1)
        deltas[0].should.match(/"func":"return msg;"/)
    })

    it('should trim FIM context and return the nested completion shape expected by the browser', async function () {
        fakeGot.post.resolves({
            body: {
                choices: [{
                    message: {
                        content: JSON.stringify({ fim_completion: 'msg.payload' })
                    }
                }]
            }
        })

        const prefix = Array.from({ length: DEFAULT_FIM_PREFIX_LINES + 25 }, (_, index) => `prefix-${index}`).join('\n')
        const suffix = Array.from({ length: DEFAULT_FIM_SUFFIX_LINES + 10 }, (_, index) => `suffix-${index}`).join('\n')
        const backend = new DeepSeekBackend({
            got: fakeGot,
            apiKey: 'sk-test',
            RED
        })

        const result = await backend.run({
            feature: 'fim',
            prompt: `${prefix}<|fim_completion|>${suffix}`,
            context: {
                nodeModule: 'node-red',
                nodeType: 'function',
                nodeContext: {
                    category: 'function',
                    inputs: 1,
                    outputs: 1,
                    paletteLabel: 'function',
                    defaultProperties: ['name', 'func', 'outputs'],
                    helpSummary: 'Runs custom JavaScript against the incoming message.'
                }
            },
            transactionId: 'tx-fim'
        })

        result.should.eql({
            data: {
                data: {
                    fim_completion: 'msg.payload'
                }
            }
        })

        const [, options] = fakeGot.post.firstCall.args
        options.json.max_tokens.should.equal(192)
        options.json.temperature.should.equal(0.1)
        const userMessage = options.json.messages[1].content
        userMessage.should.match(/Node module: node-red/)
        userMessage.should.match(/Node type: function/)
        userMessage.should.match(/Node category: function/)
        userMessage.should.match(/Editable properties: name, func, outputs/)
        userMessage.should.match(/Node help summary: Runs custom JavaScript against the incoming message\./)
        userMessage.should.match(/<\|fim_completion\|>/)
        userMessage.should.not.match(/prefix-0/)
        userMessage.should.match(new RegExp(`prefix-${DEFAULT_FIM_PREFIX_LINES + 24}`))
        userMessage.should.match(/suffix-0/)
        userMessage.should.not.match(new RegExp(`suffix-${DEFAULT_FIM_SUFFIX_LINES + 9}`))
    })

    it('should return markdown directly for explain_flow and skip JSON mode', async function () {
        fakeGot.post.resolves({
            body: {
                choices: [{
                    message: {
                        content: '### Summary\n\nA short explanation.\n\n### Details\n\n- Step one'
                    }
                }]
            }
        })

        const backend = new DeepSeekBackend({
            got: fakeGot,
            apiKey: 'sk-test',
            RED
        })

        const result = await backend.run({
            feature: 'explain_flow',
            prompt: 'explain_flow',
            transactionId: 'tx-explain',
            context: {
                promptId: 'explain_flow',
                prompt: {
                    messages: [
                        { content: { text: 'Explain this flow please.' } }
                    ]
                }
            }
        })

        result.should.eql({
            data: '### Summary\n\nA short explanation.\n\n### Details\n\n- Step one'
        })

        const [, options] = fakeGot.post.firstCall.args
        should(options.json.response_format).be.undefined()
        options.json.max_tokens.should.equal(1200)
    })

    it('should require an API key', function () {
        (() => {
            return new DeepSeekBackend({ got: fakeGot, RED })
        }).should.throw(/DEEPSEEK_API_KEY/)
    })
})

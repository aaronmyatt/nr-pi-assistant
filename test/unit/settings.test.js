/// <reference types="should" />
'use strict'

const should = require('should')
const settings = require('../../lib/settings')

describe('settings', function () {
    let RED

    beforeEach(function () {
        RED = { settings: { flowforge: {} } }
    })

    describe('getSettings', function () {
        it('should be disabled if assistant is not enabled', async function () {
            RED.settings.flowforge.assistant = { enabled: false }
            const result = await settings.getSettings(RED)
            result.enabled.should.be.false()
        })

        it('should be enabled with defaults', async function () {
            RED.settings.flowforge.assistant = { enabled: true }
            const result = await settings.getSettings(RED)
            result.enabled.should.be.true()
            result.completions.should.be.an.Object()
            result.completions.enabled.should.be.true()
            should(result.completions.modelUrl).be.null()
            should(result.completions.vocabularyUrl).be.null()
        })

        it('should preserve completions if provided and enabled', async function () {
            RED.settings.flowforge.assistant = {
                enabled: true,
                completions: {
                    enabled: false,
                    modelUrl: 'http://model',
                    vocabularyUrl: 'http://vocab'
                }
            }
            const result = await settings.getSettings(RED)
            result.completions.enabled.should.be.false()
            result.completions.modelUrl.should.equal('http://model')
            result.completions.vocabularyUrl.should.equal('http://vocab')
        })

        it('should preserve direct DeepSeek transport settings', async function () {
            RED.settings.flowforge.assistant = {
                enabled: true,
                backend: 'deepseek',
                baseUrl: 'https://api.deepseek.com',
                model: 'deepseek-v4-flash',
                requestTimeout: 15000
            }
            const result = await settings.getSettings(RED)
            result.backend.should.equal('deepseek')
            result.baseUrl.should.equal('https://api.deepseek.com')
            result.model.should.equal('deepseek-v4-flash')
            result.requestTimeout.should.equal(15000)
        })

        it('should set tables.enabled false by default (tables are FlowFuse-only)', async function () {
            RED.settings.flowforge.tables = { token: 'abc' }
            RED.settings.flowforge.assistant = { enabled: true }
            const result = await settings.getSettings(RED)
            result.tables.enabled.should.be.false()
        })

        it('should set mcp.enabled true by default', async function () {
            RED.settings.flowforge.assistant = { enabled: true }
            const result = await settings.getSettings(RED)
            result.mcp.should.be.an.Object()
            result.mcp.enabled.should.be.true()
        })

        it('should default to enabled when flowforge or assistant is missing', async function () {
            RED = { settings: {} }
            const result = await settings.getSettings(RED)
            result.enabled.should.be.true() // defaults to enabled
            result.backend.should.equal('flowfuse')
        })
    })
})

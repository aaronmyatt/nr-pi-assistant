/// <reference types="should" />
'use strict'
const should = require('should')

const [major] = process.versions.node.split('.').map(Number)
const describeMain = major < 20 ? describe.skip : describe

describeMain('nodeContext helpers', function () {
    let nodeContextModule

    beforeEach(async () => {
        nodeContextModule = await import('../../../resources/nodeContext.js')
    })

    afterEach(() => {
        delete global.document
        delete require.cache[require.resolve('../../../resources/nodeContext.js')]
    })

    it('should build enriched node type context from installed help html', function () {
        const RED = {
            nodes: {
                getType: () => ({
                    set: { module: 'node-red' },
                    category: 'function',
                    defaults: { name: { value: '' }, func: { value: '' } },
                    inputs: 1,
                    outputs: 2,
                    label: function label () { return this.name || 'Function' }
                })
            }
        }
        const doc = {
            querySelector: () => ({
                innerHTML: '<p>Runs custom JavaScript against the incoming message.</p><p>More detail.</p>',
                getAttribute: () => 'text/html'
            })
        }

        const result = nodeContextModule.getNodeTypeContext({ RED, type: 'function', doc })

        should(result.installed).be.undefined()
        result.type.should.equal('function')
        result.module.should.equal('node-red')
        result.category.should.equal('function')
        result.inputs.should.equal(1)
        result.outputs.should.equal(2)
        result.defaultProperties.should.deepEqual(['name', 'func'])
        result.helpHtml.should.match(/Runs custom JavaScript/)
        result.helpSummary.should.equal('Runs custom JavaScript against the incoming message.')
        result.helpTooltip.should.equal('Runs custom JavaScript against the incoming message.')
    })

    it('should render markdown help before extracting the summary', function () {
        const RED = {
            nodes: {
                getType: () => ({ defaults: {}, inputs: 0, outputs: 1 })
            },
            utils: {
                renderMarkdown: (markdown) => `<p>${markdown.toUpperCase()}</p>`
            }
        }
        const doc = {
            querySelector: () => ({
                innerHTML: 'markdown summary',
                getAttribute: () => 'text/markdown'
            })
        }

        const result = nodeContextModule.getNodeTypeContext({ RED, type: 'inject', doc })
        result.helpHtml.should.equal('<p>MARKDOWN SUMMARY</p>')
        result.helpSummary.should.equal('MARKDOWN SUMMARY')
    })

    it('should degrade gracefully when help is missing', function () {
        const RED = {
            nodes: {
                getType: () => ({ defaults: {}, inputs: 0, outputs: 1 })
            }
        }
        const doc = {
            querySelector: () => null
        }

        const result = nodeContextModule.getNodeTypeContext({ RED, type: 'inject', doc })
        should(result.helpHtml).be.null()
        should(result.helpSummary).be.null()
        should(result.helpTooltip).be.null()
    })

    it('should project a prompt-friendly node context without full help html', function () {
        const result = nodeContextModule.toPromptNodeContext({
            installed: true,
            type: 'function',
            module: 'node-red',
            category: 'function',
            inputs: 1,
            outputs: 1,
            paletteLabel: 'function',
            workspaceLabel: 'Normalize payload',
            defaultProperties: ['name', 'func', 'outputs'],
            helpSummary: 'Runs custom JavaScript.',
            helpTooltip: 'Runs custom JavaScript.',
            helpHtml: '<p>Runs custom JavaScript.</p>'
        })

        result.should.deepEqual({
            type: 'function',
            module: 'node-red',
            category: 'function',
            inputs: 1,
            outputs: 1,
            paletteLabel: 'function',
            workspaceLabel: 'Normalize payload',
            defaultProperties: ['name', 'func', 'outputs'],
            helpSummary: 'Runs custom JavaScript.',
            helpTooltip: 'Runs custom JavaScript.'
        })
    })
})

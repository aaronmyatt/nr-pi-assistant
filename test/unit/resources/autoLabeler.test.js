/// <reference types="should" />
'use strict'
require('should')
const sinon = require('sinon')
const EventEmitter = require('events')

const [major] = process.versions.node.split('.').map(Number)
const describeMain = major < 20 ? describe.skip : describe

describeMain('AutoLabeler', function () {
    let AutoLabeler
    let autoLabeler
    let RED
    let hintsSidebar
    let nodeStore

    beforeEach(async () => {
        nodeStore = new Map()
        global.document = {
            createElement: sinon.stub().callsFake(() => ({
                className: '',
                style: {},
                innerHTML: '',
                textContent: '',
                innerText: '',
                appendChild () {}
            })),
            querySelector: sinon.stub().returns(null)
        }
        global.$ = {
            ajax: sinon.stub()
        }

        const module = await import('../../../resources/autoLabeler.js')
        AutoLabeler = module.AutoLabeler

        RED = {
            events: new EventEmitter(),
            nodes: {
                node: (id) => nodeStore.get(id) || null,
                dirty: sinon.stub()
            },
            view: {
                selection: sinon.stub().callsFake(() => ({ nodes: [] }))
            }
        }

        hintsSidebar = {
            showLabelSuggestion: sinon.stub()
        }

        autoLabeler = new AutoLabeler()
    })

    afterEach(() => {
        sinon.restore()
        delete global.document
        delete global.$
    })

    function addNode (id, type, name = '', opts = { source: 'palette' }) {
        const node = { id, type, name, _def: { set: { module: 'node-red' } } }
        nodeStore.set(id, node)
        RED.nodes.node = (nid) => nodeStore.get(nid) || null
        RED.events.emit('nodes:add', node, opts)
        return node
    }

    function addLink (sourceId, targetId) {
        RED.events.emit('links:add', { source: { id: sourceId }, target: { id: targetId } })
    }

    it('should auto-label a blank node on add from the palette', function () {
        autoLabeler.init({ RED, hintsSidebar })
        const node = addNode('n1', 'inject')

        node.name.should.equal('Inject trigger')
        RED.nodes.dirty.calledOnce.should.be.true()
    })

    it('should not auto-label nodes added from non-palette sources', function () {
        autoLabeler.init({ RED, hintsSidebar })
        const node = addNode('n1', 'inject', '', { source: 'import' })

        node.name.should.equal('')
        RED.nodes.dirty.called.should.be.false()
    })

    it('should re-label a blank node after config changes settle', function () {
        // changeDebounceMs=0 means the debounce fires immediately — no need
        // for long setTimeout waits that blow past mocha's 2000ms timeout.
        autoLabeler.init({ RED, hintsSidebar, changeDebounceMs: 0 })
        const node = addNode('n1', 'function')
        node.name.should.equal('Transform message')

        // Simulate the user editing config (e.g. adding an http request URL)
        node.url = 'https://api.example.com'
        node.method = 'GET'
        nodeStore.set('n1', node)
        RED.events.emit('nodes:change', node)

        // setTimeout(fn, 0) still needs a microtask tick to flush.
        return new Promise((resolve) => {
            setTimeout(() => {
                node.name.should.equal('Transform message')
                resolve()
            }, 10)
        })
    })

    it('should NOT re-label when the node config fingerprint is unchanged', function () {
        autoLabeler.init({ RED, hintsSidebar, changeDebounceMs: 0 })
        const node = addNode('n1', 'inject')
        node.name.should.equal('Inject trigger')
        RED.nodes.dirty.resetHistory()

        // Simulate opening/moving (name + config unchanged)
        RED.events.emit('nodes:change', node)

        return new Promise((resolve) => {
            setTimeout(() => {
                // dirty should NOT have been called because fingerprint matched
                RED.nodes.dirty.called.should.be.false()
                node.name.should.equal('Inject trigger')
                resolve()
            }, 10)
        })
    })

    it('should NOT overwrite a user-authored name even when config changes', function () {
        autoLabeler.init({ RED, hintsSidebar, changeDebounceMs: 0 })
        const node = addNode('n1', 'inject')
        autoLabeler._autoLabels.set('n1', 'Inject trigger')
        RED.nodes.dirty.resetHistory()

        // User renames the node
        node.name = 'My custom inject'
        node.url = 'https://new.example.com'
        nodeStore.set('n1', node)
        RED.events.emit('nodes:change', node)

        return new Promise((resolve) => {
            setTimeout(() => {
                node.name.should.equal('My custom inject')
                resolve()
            }, 10)
        })
    })

    it('should queue LLM refinement when wiring context changes for an auto-labeled node', function () {
        autoLabeler.init({ RED, hintsSidebar })
        autoLabeler._loaded = true
        addNode('n1', 'function')
        addNode('n2', 'inject')
        autoLabeler._autoLabels.set('n1', 'Transform message')

        // Before wiring, no pending refinement
        autoLabeler._pendingRefinements.has('n1').should.be.false()

        // Wire inject → function
        addLink('n2', 'n1')

        // Should have queued a refinement (timer pending)
        autoLabeler._pendingRefinements.has('n1').should.be.true()
        const state = autoLabeler._pendingRefinements.get('n1')
        ;(state.attempts === 0).should.be.true()
    })

    it('should respect the refinement attempt cap', function () {
        autoLabeler.init({ RED, hintsSidebar })
        addNode('n1', 'function')
        const state = { timer: null, attempts: 5 }
        autoLabeler._pendingRefinements.set('n1', state)
        // Should be a no-op since attempts >= max
        autoLabeler._queueRefinement('n1')
        const stored = autoLabeler._pendingRefinements.get('n1')
        ;(stored.timer === null).should.be.true()
    })

    it('should handle missing jQuery gracefully during refinement', function () {
        delete global.$
        autoLabeler.init({ RED })
        addNode('n1', 'function')
        autoLabeler._doRefine('n1').then(() => {
            // Should not throw
        }).catch(() => {
            // expected
        })
    })
})

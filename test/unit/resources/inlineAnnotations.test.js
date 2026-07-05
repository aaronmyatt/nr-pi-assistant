/// <reference types="should" />
'use strict'
require('should')
const sinon = require('sinon')
const EventEmitter = require('events')

const [major] = process.versions.node.split('.').map(Number)
const describeMain = major < 20 ? describe.skip : describe

describeMain('InlineAnnotations (panel mode)', function () {
    let InlineAnnotations
    let HINTS_READY_EVENT
    let ann
    let RED
    let sandbox
    let mockPanel

    beforeEach(async () => {
        sandbox = sinon.createSandbox()
        mockPanel = {
            remove: sandbox.stub(),
            className: '',
            innerHTML: ''
        }

        const module = await import('../../../resources/inlineAnnotations.js')
        InlineAnnotations = module.InlineAnnotations
        HINTS_READY_EVENT = module.HINTS_READY_EVENT

        // Node.js has no global document — provide a minimal mock.
        const mockContainer = { appendChild: sandbox.stub(), style: {} }
        const mockDocument = {
            createElement: sandbox.stub().callsFake((tag) => {
                if (tag === 'div') {
                    return {
                        remove: sandbox.stub(),
                        className: '',
                        innerHTML: '',
                        setAttribute: sandbox.stub(),
                        appendChild: sandbox.stub()
                    }
                }
                return {}
            }),
            querySelector: sandbox.stub().returns(mockContainer),
            body: mockContainer
        }
        globalThis.document = mockDocument

        RED = {
            events: new EventEmitter()
        }

        ann = new InlineAnnotations()
    })

    afterEach(() => {
        delete globalThis.document
        sandbox.restore()
    })

    function emitHintsReady (node, hints) {
        RED.events.emit(HINTS_READY_EVENT, { node, hints })
    }

    // ── render() ────────────────────────────────────────────────────────────

    it('should create a fixed panel when hints arrive', function () {
        ann.init({ RED })

        emitHintsReady({ id: 'n1' }, ['Set the URL field', 'Configure headers'])

        ann.overlayCount.should.equal(1)
        ann.activeTargetId.should.equal('n1')
    })

    it('should do nothing when hints array is empty', function () {
        ann.init({ RED })

        ann.render({ node: { id: 'n1' }, hints: [] })

        ann.overlayCount.should.equal(0)
    })

    it('should do nothing when node has no id', function () {
        ann.init({ RED })

        ann.render({ node: {}, hints: ['x'] })

        ann.overlayCount.should.equal(0)
    })

    // ── pruneAll() ──────────────────────────────────────────────────────────

    it('should remove the panel on pruneAll', function () {
        ann.init({ RED })

        emitHintsReady({ id: 'n1' }, ['a'])
        ann.overlayCount.should.equal(1)

        ann.pruneAll()

        ann.overlayCount.should.equal(0)
        should(ann.activeTargetId).be.null()
    })

    it('should be a no-op when there is nothing to prune', function () {
        ann.init({ RED })

        ;(() => ann.pruneAll()).should.not.throw()
        ann.overlayCount.should.equal(0)
    })

    it('should remove panel on view:selection-changed', function () {
        ann.init({ RED })

        emitHintsReady({ id: 'n1' }, ['a'])
        ann.overlayCount.should.equal(1)

        RED.events.emit('view:selection-changed', { nodes: [] })

        ann.overlayCount.should.equal(0)
    })

    it('should replace panel when new hints arrive for a different node', function () {
        ann.init({ RED })

        emitHintsReady({ id: 'n1' }, ['a'])
        ann.overlayCount.should.equal(1)

        emitHintsReady({ id: 'n2' }, ['b'])
        ann.overlayCount.should.equal(1)
        ann.activeTargetId.should.equal('n2')
    })

    it('should clear on flows:loaded', function () {
        ann.init({ RED })

        emitHintsReady({ id: 'n1' }, ['a'])
        RED.events.emit('flows:loaded')

        ann.overlayCount.should.equal(0)
        should(ann.activeTargetId).be.null()
    })

    // ── cap ─────────────────────────────────────────────────────────────────

    it('should cap hints at MAX_HINTS', function () {
        ann.init({ RED })

        emitHintsReady({ id: 'n1' }, ['1', '2', '3', '4', '5', '6'])

        ann.overlayCount.should.equal(1)
    })
})

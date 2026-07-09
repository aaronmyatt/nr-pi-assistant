/// <reference types="should" />
'use strict'
require('should')
const sinon = require('sinon')
const EventEmitter = require('events')

const [major] = process.versions.node.split('.').map(Number)
const describeMain = major < 20 ? describe.skip : describe

describeMain('InlineAnnotations (panel mode)', function () {
    let InlineAnnotations
    let HINTS_READY_EVENT, NEXT_NODE_READY_EVENT
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
        NEXT_NODE_READY_EVENT = module.NEXT_NODE_READY_EVENT

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
        globalThis.cancelAnimationFrame = sandbox.stub()

        RED = {
            events: new EventEmitter(),
            view: {} // will be populated per-test as needed
        }

        ann = new InlineAnnotations()
    })

    afterEach(() => {
        delete globalThis.document
        delete globalThis.requestAnimationFrame
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

    it('should remove panel on view:selection-changed (different node)', function () {
        ann.init({ RED })

        emitHintsReady({ id: 'n1' }, ['a'])
        ann.overlayCount.should.equal(1)

        // Selection of a different node — should prune
        RED.events.emit('view:selection-changed', { nodes: [{ id: 'n2' }] })

        ann.overlayCount.should.equal(0)
    })

    it('should NOT prune when selection matches the panel target (cache hit guard)', function () {
        ann.init({ RED })

        emitHintsReady({ id: 'n1' }, ['a'])
        ann.overlayCount.should.equal(1)

        // Selection of the same node — should keep the panel
        RED.events.emit('view:selection-changed', { nodes: [{ id: 'n1' }] })

        ann.overlayCount.should.equal(1)
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

    // ── Ghost flow rendering (TASK-12.9) ────────────────────────────────────

    it('should render next-node suggestions as ghost flow when output is empty', function () {
        ann.init({ RED, assistantOptions: { enabled: true } })

        // Provide a mock setSuggestedFlow on RED.view + gridSize.
        let callArgs = null
        RED.view = {
            setSuggestedFlow: sandbox.stub().callsFake((arg) => { callArgs = arg }),
            gridSize: sandbox.stub().returns(20)
        }

        // Mock RED.nodes.eachNode — no existing nodes, so default spot is clear.
        RED.nodes = { eachNode: sandbox.stub().callsFake((fn) => { /* no nodes */ }) }

        // Mock querySelectorAll and _measureTextWidth for label step.
        // _measureTextWidth uses canvas — unavailable in Node.js.
        sandbox.stub(ann, '_measureTextWidth').callsFake((text) => (text || '').length * 7)
        const mockLabelText = { textContent: 'debug' }
        const mockGhostEl = {
            querySelectorAll: sandbox.stub().returns([mockLabelText]),
            querySelector: sandbox.stub().returns(null),
            getAttribute: sandbox.stub().returns(null),
            setAttribute: sandbox.stub()
        }
        globalThis.document.querySelectorAll = sandbox.stub().returns([mockGhostEl])
        // rAF mock: fire first 3 frames synchronously, then stop to prevent
        // infinite recursion from the label-poll loop.
        let rafCalls = 0
        globalThis.requestAnimationFrame = (fn) => { rafCalls++; if (rafCalls <= 3) fn() }

        const node = { id: 'n1', type: 'inject', x: 200, y: 100, w: 100, wires: [[], []] }
        const suggestions = [
            { type: 'debug', reason: 'log output', wireFromPort: 0 },
            { type: 'function', reason: 'transform', wireFromPort: 0 }
        ]

        ann.renderNextNode({ node, suggestions })

        // Should NOT create a text panel (overlayCount stays 0).
        ann.overlayCount.should.equal(0)

        // Should call setSuggestedFlow with the correct shape.
        RED.view.setSuggestedFlow.calledOnce.should.be.true()
        callArgs.should.not.be.null()
        callArgs.source.should.equal(node)
        callArgs.clickToApply.should.be.true()

        // Each suggestion becomes its own page so arrow keys can cycle.
        callArgs.nodes.should.be.an.Array()
        callArgs.nodes.should.have.length(2)
        callArgs.nodes[0][0].type.should.equal('debug')
        callArgs.nodes[1][0].type.should.equal('function')

        // Should use explicit x,y (not position:'relative') at the default spot.
        // Default: source.x + source.w + 3*grid = 200 + 100 + 60 = 360
        callArgs.nodes[0][0].x.should.equal(360)
        callArgs.nodes[0][0].y.should.equal(100)

        // Name should carry the reason so accepted nodes get pre-populated labels.
        callArgs.nodes[0][0].name.should.equal('log output')
        callArgs.nodes[1][0].name.should.equal('transform')
    })

    it('should fall back to text panel when output port is already wired', function () {
        ann.init({ RED })

        RED.view = {
            setSuggestedFlow: sandbox.stub()
        }

        // Port 0 already has a wire to another node.
        const node = { id: 'n1', type: 'inject', wires: [['n2']] }
        const suggestions = [{ type: 'debug', reason: 'log', wireFromPort: 0 }]

        ann.renderNextNode({ node, suggestions })

        // Should NOT call setSuggestedFlow.
        RED.view.setSuggestedFlow.called.should.be.false()

        // Should create a text panel instead.
        ann.overlayCount.should.equal(1)
    })

    it('should fall back to text panel when setSuggestedFlow is not available', function () {
        ann.init({ RED })

        // No setSuggestedFlow on RED.view (e.g. Node-RED v4).
        RED.view = {}

        const node = { id: 'n1', type: 'inject', wires: [] }
        const suggestions = [{ type: 'debug', reason: 'log', wireFromPort: 0 }]

        ann.renderNextNode({ node, suggestions })

        // Should create a text panel instead.
        ann.overlayCount.should.equal(1)
    })

    // ── _hasDownstreamConnections ───────────────────────────────────────────

    it('should detect downstream connections via node.wires', function () {
        ann.init({ RED })

        // Empty wires — nothing downstream.
        ann._hasDownstreamConnections({ wires: [[], []] }).should.be.false()
        ann._hasDownstreamConnections({ wires: [] }).should.be.false()
        ann._hasDownstreamConnections({ wires: undefined }).should.be.false()
        ann._hasDownstreamConnections({}).should.be.false()

        // Wired output port.
        ann._hasDownstreamConnections({ wires: [['n2']] }).should.be.true()
        ann._hasDownstreamConnections({ wires: [[], ['n2']] }).should.be.true()
    })

    // ── _resolveSourcePort ─────────────────────────────────────────────────

    it('should resolve the suggested wireFromPort when available and empty', function () {
        ann.init({ RED })

        // Suggestion says wire from port 1, and port 1 is empty.
        ann._nextNodes = [{ type: 'debug', wireFromPort: 1 }]
        const node = { wires: [['n2'], []] } // port 0 wired, port 1 empty

        ann._resolveSourcePort(node).should.equal(1)
    })

    it('should fall back to the first empty port when wireFromPort is occupied', function () {
        ann.init({ RED })

        // Suggestion says wire from port 0, but port 0 is already wired.
        ann._nextNodes = [{ type: 'debug', wireFromPort: 0 }]
        const node = { wires: [['n2'], []] } // port 0 wired, port 1 empty

        ann._resolveSourcePort(node).should.equal(1)
    })

    // ── _labelGhostNodes ───────────────────────────────────────────────────

    /**
     * Build a mock ghost SVG <g> element for label/resize assertions.
     * getComputedTextLength returns different values across calls: the
     * first call simulates the type-name width, the second simulates the
     * (wider) reason width after textContent is updated.
     */
    function mockGhostEl ({ oldWidth, newWidth }) {
        const label = {
            textContent: 'type-name',
            getComputedTextLength: sandbox.stub()
        }
        label.getComputedTextLength.onCall(0).returns(oldWidth)
        label.getComputedTextLength.onCall(1).returns(newWidth)

        const mainRect = { getAttribute: sandbox.stub().returns('100'), setAttribute: sandbox.stub() }
        const haloRect = { getAttribute: sandbox.stub().returns('106'), setAttribute: sandbox.stub() }

        return {
            querySelectorAll: sandbox.stub().returns([label]),
            querySelector: sandbox.stub()
                .withArgs('rect.red-ui-flow-node').returns(mainRect)
                .withArgs('rect.red-ui-flow-node-highlight').returns(haloRect),
            getAttribute: sandbox.stub().returns('translate(150,100)'),
            setAttribute: sandbox.stub(),
            _mainRect: mainRect,
            _haloRect: haloRect,
            _label: label
        }
    }

    it('should replace ghost node labels with reason text', function () {
        ann.init({ RED })

        sandbox.stub(ann, '_measureTextWidth').callsFake((text) => (text || '').length * 7)
        ann._nextNodes = [{ type: 'function', reason: 'Inspect output' }]
        const ghost = mockGhostEl({ oldWidth: 40, newWidth: 90 })
        ghost._label.textContent = 'function' // ghost label = type name
        globalThis.document.querySelectorAll = sandbox.stub().returns([ghost])

        ann._labelGhostNodes()

        ghost._label.textContent.should.equal('Inspect output')
    })

    it('should resize the ghost rects when reason is wider than type name', function () {
        ann.init({ RED })

        // Test _resizeGhostNode directly — only rects grow, no group shift.
        const mainRect = { getAttribute: sandbox.stub().returns('100'), setAttribute: sandbox.stub() }
        const haloRect = { getAttribute: sandbox.stub().returns('106'), setAttribute: sandbox.stub() }
        const ghostEl = {
            querySelector: sandbox.stub()
        }
        ghostEl.querySelector.withArgs('rect.red-ui-flow-node').returns(mainRect)
        ghostEl.querySelector.withArgs('rect.red-ui-flow-node-highlight').returns(haloRect)

        ann._resizeGhostNode(ghostEl, 160)

        mainRect.setAttribute.calledWith('width', 260).should.be.true()
        haloRect.setAttribute.calledWith('width', 266).should.be.true()
    })

    it('should resize the ghost rects via _labelGhostNodes when reason is longer', function () {
        ann.init({ RED })

        // _measureTextWidth: old (debug=5*7=35) vs new (reason=27*7=189).
        // extraWidth = 189*1.25 - 35 = 236 - 35 = 201 > 0 → resize.
        sandbox.stub(ann, '_measureTextWidth').callsFake((text) => (text || '').length * 7)
        ann._nextNodes = [{ type: 'function', reason: 'Inspect and log msg payload' }]

        const label = { textContent: 'function' } // ghost label = type name
        const mainRect = { getAttribute: sandbox.stub().returns('100'), setAttribute: sandbox.stub() }
        const haloRect = { getAttribute: sandbox.stub().returns('106'), setAttribute: sandbox.stub() }
        const ghost = {
            querySelectorAll: sandbox.stub().returns([label]),
            querySelector: sandbox.stub(),
            getAttribute: sandbox.stub().returns('translate(150,100)'),
            setAttribute: sandbox.stub(),
            _mainRect: mainRect,
            _haloRect: haloRect
        }
        ghost.querySelector.withArgs('rect.red-ui-flow-node').returns(mainRect)
        ghost.querySelector.withArgs('rect.red-ui-flow-node-highlight').returns(haloRect)
        globalThis.document.querySelectorAll = sandbox.stub().returns([ghost])

        ann._labelGhostNodes()

        label.textContent.should.equal('Inspect and log msg payload')
        mainRect.setAttribute.calledWith('width').should.be.true()
        haloRect.setAttribute.calledWith('width').should.be.true()
    })

    it('should not resize when reason is shorter than type name', function () {
        ann.init({ RED })

        // old (13*7=91) vs new safety (3*7*1.25=26) → extraWidth = 26-91 = -65 → no resize
        sandbox.stub(ann, '_measureTextWidth').callsFake((text) => (text || '').length * 7)
        ann._nextNodes = [{ type: 'http request', reason: 'GET' }]
        const ghost = mockGhostEl({ oldWidth: 80, newWidth: 21 })
        globalThis.document.querySelectorAll = sandbox.stub().returns([ghost])

        ann._labelGhostNodes()

        ghost._mainRect.setAttribute.called.should.be.false()
        ghost.setAttribute.called.should.be.false()
    })

    it('should leave label unchanged when reason is empty', function () {
        ann.init({ RED })

        ann._nextNodes = [{ type: 'debug', reason: '' }]
        const label = { textContent: 'debug' }
        const ghost = {
            querySelectorAll: sandbox.stub().returns([label]),
            querySelector: sandbox.stub().returns(null)
        }
        globalThis.document.querySelectorAll = sandbox.stub().returns([ghost])

        ann._labelGhostNodes()

        label.textContent.should.equal('debug')
    })

    it('should leave debug node labels unchanged (self-explanatory)', function () {
        ann.init({ RED })

        ann._nextNodes = [{ type: 'debug', reason: 'Inspect output' }]
        const label = { textContent: 'debug' }
        const ghost = {
            querySelectorAll: sandbox.stub().returns([label]),
            querySelector: sandbox.stub().returns(null)
        }
        globalThis.document.querySelectorAll = sandbox.stub().returns([ghost])

        ann._labelGhostNodes()

        // Debug nodes keep their default label — no reason replacement.
        label.textContent.should.equal('debug')
    })

    it('should not throw when no ghost elements are found', function () {
        ann.init({ RED })

        ann._nextNodes = [{ type: 'debug', reason: 'test' }]
        globalThis.document.querySelectorAll = sandbox.stub().returns([])

        ;(() => ann._labelGhostNodes()).should.not.throw()
    })

    // ── _collectExistingNodes ──────────────────────────────────────────────

    it('should collect non-ghost nodes from the canvas', function () {
        ann.init({ RED })

        const realNode = { id: 'n1', type: 'inject', x: 200, y: 100, w: 100, h: 30, _def: {} }
        const ghostNode = { id: 'g1', type: 'debug', x: 400, y: 100, w: 80, h: 30, __ghost: true, _def: {} }

        RED.nodes = {
            eachNode: sandbox.stub().callsFake((fn) => {
                fn(realNode)
                fn(ghostNode)
            })
        }

        const result = ann._collectExistingNodes()

        // Ghost and config nodes excluded; real nodes mapped to bounding boxes.
        result.should.have.length(1)
        // x,y are top-left (centre - w/2, centre - h/2)
        result[0].x.should.equal(150) // 200 - 50
        result[0].y.should.equal(85)  // 100 - 15
        result[0].w.should.equal(100)
        result[0].h.should.equal(30)
    })

    // ── _findClearSpot ─────────────────────────────────────────────────────

    it('should return default spot when no nodes overlap', function () {
        ann.init({ RED })

        // A node far away from the default ghost position.
        const existing = [{ x: 0, y: 0, w: 100, h: 30 }]

        const result = ann._findClearSpot(360, 100, 120, 30, existing, 20)

        result.x.should.equal(360)
        result.y.should.equal(100)
    })

    it('should step downward when default spot overlaps an existing node', function () {
        ann.init({ RED })

        // A node sitting right where the ghost would go.
        const existing = [{ x: 350, y: 95, w: 100, h: 30 }]

        const result = ann._findClearSpot(360, 100, 120, 30, existing, 20)

        // Should have stepped down by ghostH + gridSize = 50
        result.x.should.equal(360)
        result.y.should.be.above(100)
    })

    // ── _clearGhostFlow ────────────────────────────────────────────────────

    it('should call setSuggestedFlow(null) to dismiss ghost flow', function () {
        ann.init({ RED })

        RED.view = {
            setSuggestedFlow: sandbox.stub()
        }

        ann._clearGhostFlow()

        RED.view.setSuggestedFlow.calledOnceWith(null).should.be.true()
    })

    it('should be a no-op when setSuggestedFlow is not available', function () {
        ann.init({ RED })

        RED.view = {}

        ;(() => ann._clearGhostFlow()).should.not.throw()
    })

    // ── pruneAll + ghost flow cleanup ──────────────────────────────────────

    it('should clear ghost flow on pruneAll', function () {
        ann.init({ RED })

        let cleared = false
        RED.view = {
            setSuggestedFlow: sandbox.stub().callsFake((arg) => {
                if (arg === null) cleared = true
            })
        }

        // Set up hints panel + ghost state.
        emitHintsReady({ id: 'n1' }, ['a'])
        ann._nextNodes = [{ type: 'debug' }]

        ann.pruneAll()

        cleared.should.be.true()
        ann.overlayCount.should.equal(0)
    })

    it('should clear ghost flow on flows:loaded', function () {
        ann.init({ RED })

        let cleared = false
        RED.view = {
            setSuggestedFlow: sandbox.stub().callsFake((arg) => {
                if (arg === null) cleared = true
            })
        }

        emitHintsReady({ id: 'n1' }, ['a'])
        RED.events.emit('flows:loaded')

        cleared.should.be.true()
    })
})

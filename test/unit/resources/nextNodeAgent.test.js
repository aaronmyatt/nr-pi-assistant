/// <reference types="should" />
'use strict'
require('should')
const sinon = require('sinon')

const [major] = process.versions.node.split('.').map(Number)
const describeMain = major < 20 ? describe.skip : describe

describeMain('NextNodeAgent', function () {
    let NextNodeAgent, AgentScheduler
    let RED, scheduler

    beforeEach(async () => {
        const nextNodeModule = await import('../../../resources/nextNodeAgent.js')
        NextNodeAgent = nextNodeModule.NextNodeAgent

        const schedulerModule = await import('../../../resources/agentScheduler.js')
        AgentScheduler = schedulerModule.AgentScheduler

        // ── Mock RED (minimal Node-RED API surface) ──────────────────────
        RED = {
            events: {
                _handlers: {},
                on (event, handler) {
                    this._handlers[event] = this._handlers[event] || []
                    this._handlers[event].push(handler)
                },
                emit (event, payload) {
                    const handlers = this._handlers[event] || []
                    for (const h of handlers) h(payload)
                }
            },
            nodes: {
                _all: [],
                eachNode (fn) {
                    for (const n of this._all) fn(n)
                },
                selected: null
            },
            workspace: null
        }

        scheduler = new AgentScheduler()
    })

    function makeNode (id, type = 'inject', overrides = {}) {
        return { id, type, wires: [], ...overrides }
    }

    // ── init ────────────────────────────────────────────────────────────────

    it('should register with the scheduler on init', function () {
        const agent = new NextNodeAgent()
        agent.init({ RED, scheduler })

        scheduler.hasAgent('next-node').should.be.true()
    })

    it('should emit no event when disabled', function () {
        const agent = new NextNodeAgent()
        agent.init({ RED, assistantOptions: { enabled: false }, scheduler })

        let emitted = false
        RED.events.on('nr-assistant:next-node-ready', () => { emitted = true })

        RED.nodes._all = [makeNode('n1')]
        RED.events.emit('view:selection-changed', { nodes: [makeNode('n1')] })

        emitted.should.be.false()
    })

    it('should not fire for multi-selection', function () {
        const agent = new NextNodeAgent()
        agent.init({ RED, assistantOptions: { enabled: true }, scheduler })

        let emitted = false
        RED.events.on('nr-assistant:next-node-ready', () => { emitted = true })

        RED.events.emit('view:selection-changed', {
            nodes: [makeNode('n1'), makeNode('n2')]
        })

        emitted.should.be.false()
    })

    // ── Scheduler integration ───────────────────────────────────────────────

    it('should deduplicate via the scheduler', function () {
        const agent = new NextNodeAgent()
        agent.init({ RED, assistantOptions: { enabled: true }, scheduler })

        // First request should be allowed.
        const p1 = scheduler.acquire('next-node', { node: makeNode('n1') })
        p1.allowed.should.be.true()

        // Second request for same node should be denied (in-flight).
        const p2 = scheduler.acquire('next-node', { node: makeNode('n1') })
        p2.allowed.should.be.false()
    })

    it('should serve from cache via scheduler', function () {
        const agent = new NextNodeAgent()
        agent.init({ RED, assistantOptions: { enabled: true }, scheduler })

        const node = makeNode('n1', 'function')

        // Acquire + commit a result.
        const p1 = scheduler.acquire('next-node', { node })
        p1.allowed.should.be.true()

        scheduler.commit('next-node', 'n1', [
            { type: 'debug', reason: 'Inspect output' }
        ], { node, fingerprint: p1.fingerprint })

        // Re-acquire — should hit cache.
        const p2 = scheduler.acquire('next-node', { node })
        p2.allowed.should.be.true()
        p2.fromCache.should.be.true()
        p2.cachedResult.should.deepEqual([
            { type: 'debug', reason: 'Inspect output' }
        ])
    })

    // ── _parseResponse ──────────────────────────────────────────────────────

    it('should parse a valid suggestions response', function () {
        const agent = new NextNodeAgent()

        const result = agent._parseResponse({
            suggestions: [
                { type: 'debug', reason: 'Inspect output', wireFromPort: 0 },
                { type: 'function', reason: 'Transform data' }
            ]
        })

        result.should.have.length(2)
        result[0].should.deepEqual({ type: 'debug', reason: 'Inspect output', wireFromPort: 0 })
        result[1].should.deepEqual({ type: 'function', reason: 'Transform data', wireFromPort: 0 })
    })

    it('should parse a JSON string response', function () {
        const agent = new NextNodeAgent()

        const result = agent._parseResponse(JSON.stringify({
            suggestions: [
                { type: 'http response', reason: 'Send the response' }
            ]
        }))

        result.should.have.length(1)
        result[0].type.should.equal('http response')
    })

    it('should extract JSON from a text response', function () {
        const agent = new NextNodeAgent()

        const result = agent._parseResponse(
            'Here are my recommendations:\n```json\n{"suggestions":[{"type":"template","reason":"Build HTML"}]}\n```'
        )

        result.should.have.length(1)
        result[0].type.should.equal('template')
    })

    it('should return empty array for null/undefined', function () {
        const agent = new NextNodeAgent()

        agent._parseResponse(null).should.deepEqual([])
        agent._parseResponse(undefined).should.deepEqual([])
        agent._parseResponse('not json').should.deepEqual([])
    })

    it('should filter out suggestions without a type', function () {
        const agent = new NextNodeAgent()

        const result = agent._parseResponse({
            suggestions: [
                { type: 'debug', reason: 'Valid' },
                { reason: 'No type' },
                { type: 'function' }
            ]
        })

        result.should.have.length(2)
        result[0].type.should.equal('debug')
        result[1].type.should.equal('function')
    })

    it('should return empty array for non-array suggestions', function () {
        const agent = new NextNodeAgent()

        agent._parseResponse({ suggestions: 'not-an-array' }).should.deepEqual([])
        agent._parseResponse({ suggestions: null }).should.deepEqual([])
    })

    // ── _getConnectedNodes ──────────────────────────────────────────────────

    it('should find downstream nodes', function () {
        const agent = new NextNodeAgent()
        agent.init({ RED, assistantOptions: { enabled: true }, scheduler })

        const n1 = makeNode('n1', 'inject', { wires: [['n2', 'n3']] })
        const n2 = makeNode('n2', 'function')
        const n3 = makeNode('n3', 'debug')

        RED.nodes._all = [n1, n2, n3]

        const { downstream } = agent._getConnectedNodes(n1)
        downstream.should.have.length(2)
        downstream[0].id.should.equal('n2')
        downstream[1].id.should.equal('n3')
    })

    it('should find upstream nodes', function () {
        const agent = new NextNodeAgent()
        agent.init({ RED, assistantOptions: { enabled: true }, scheduler })

        const n1 = makeNode('n1', 'inject', { wires: [['n3']] })
        const n2 = makeNode('n2', 'http in', { wires: [['n3']] })
        const n3 = makeNode('n3', 'function')

        RED.nodes._all = [n1, n2, n3]

        const { upstream } = agent._getConnectedNodes(n3)
        upstream.should.have.length(2)
        upstream.map(n => n.id).should.containEql('n1')
        upstream.map(n => n.id).should.containEql('n2')
    })

    it('should return empty arrays for isolated node', function () {
        const agent = new NextNodeAgent()
        agent.init({ RED, assistantOptions: { enabled: true }, scheduler })

        const n1 = makeNode('n1', 'inject')
        RED.nodes._all = [n1]

        const { upstream, downstream } = agent._getConnectedNodes(n1)
        upstream.should.be.empty()
        downstream.should.be.empty()
    })

    // ── _buildPrompt ────────────────────────────────────────────────────────

    it('should build a prompt containing node type and flow context', function () {
        const agent = new NextNodeAgent()
        agent.init({ RED, assistantOptions: { enabled: true }, scheduler })

        const node = makeNode('n1', 'function', { name: 'My Func' })
        RED.nodes._all = [node]
        RED.nodes.workspace = { label: 'Test Flow', id: 'tab-1' }

        const prompt = agent._buildPrompt(node, [], [])
        prompt.should.containEql('[function]')
        prompt.should.containEql('My Func')
        prompt.should.containEql('SELECTED NODE')
    })

    it('should include upstream and downstream in prompt', function () {
        const agent = new NextNodeAgent()
        agent.init({ RED, assistantOptions: { enabled: true }, scheduler })

        const node = makeNode('n1', 'function')
        const upstream = [makeNode('u1', 'inject', { name: 'Trigger' })]
        const downstream = [makeNode('d1', 'debug', { name: 'Logger' })]

        RED.nodes._all = [node, ...upstream, ...downstream]
        RED.nodes.workspace = { label: 'Test Flow', id: 'tab-1' }

        const prompt = agent._buildPrompt(node, upstream, downstream)
        prompt.should.containEql('UPSTREAM')
        prompt.should.containEql('DOWNSTREAM')
        prompt.should.containEql('inject')
        prompt.should.containEql('debug')
    })

    // ── Event emission ──────────────────────────────────────────────────────

    it('should emit next-node-ready event via _emitSuggestions', function () {
        const agent = new NextNodeAgent()
        agent.init({ RED, assistantOptions: { enabled: true }, scheduler })

        let emittedPayload = null
        RED.events.on('nr-assistant:next-node-ready', (payload) => {
            emittedPayload = payload
        })

        const node = makeNode('n1', 'function')
        const suggestions = [
            { type: 'debug', reason: 'Inspect output', wireFromPort: 0 }
        ]

        agent._emitSuggestions(node, suggestions)

        emittedPayload.should.not.be.null()
        emittedPayload.node.id.should.equal('n1')
        emittedPayload.suggestions.should.deepEqual(suggestions)
    })

    // ── links:add trigger ───────────────────────────────────────────────────

    it('should fire on links:add when source is the selected node', function () {
        const agent = new NextNodeAgent()
        agent.init({ RED, assistantOptions: { enabled: true }, scheduler })

        const node = makeNode('n1', 'function')
        RED.nodes._all = [node]
        RED.nodes.selected = [node]

        // Mock _request to verify it's called.
        let requestCalled = false
        agent._request = () => { requestCalled = true }

        RED.events.emit('links:add', { sourceNode: node })

        requestCalled.should.be.true()
    })

    it('should not fire on links:add when source is not selected', function () {
        const agent = new NextNodeAgent()
        agent.init({ RED, assistantOptions: { enabled: true }, scheduler })

        RED.nodes.selected = [makeNode('n2')]

        let requestCalled = false
        agent._request = () => { requestCalled = true }

        RED.events.emit('links:add', { sourceNode: makeNode('n1') })

        requestCalled.should.be.false()
    })

    // ── Downstream guard ────────────────────────────────────────────────────

    describe('_hasDownstreamConnections', function () {
        it('should return false when no wires exist', function () {
            const agent = new NextNodeAgent()
            agent.init({ RED, assistantOptions: { enabled: true }, scheduler })

            agent._hasDownstreamConnections(makeNode('n1', 'inject', { wires: [] })).should.be.false()
            agent._hasDownstreamConnections(makeNode('n1', 'inject', { wires: [[], []] })).should.be.false()
            agent._hasDownstreamConnections(makeNode('n1', 'inject', {})).should.be.false()
            agent._hasDownstreamConnections(makeNode('n1', 'inject')).should.be.false()
        })

        it('should return true when any output port has a target', function () {
            const agent = new NextNodeAgent()
            agent.init({ RED, assistantOptions: { enabled: true }, scheduler })

            agent._hasDownstreamConnections(
                makeNode('n1', 'inject', { wires: [['n2']] })
            ).should.be.true()

            // Port 1 wired, port 0 empty.
            agent._hasDownstreamConnections(
                makeNode('n1', 'inject', { wires: [[], ['n3']] })
            ).should.be.true()
        })
    })

    describe('_request downstream guard', function () {
        it('should skip LLM call when output port is already wired', function () {
            const agent = new NextNodeAgent()
            agent.init({ RED, assistantOptions: { enabled: true }, scheduler })

            const node = makeNode('n1', 'function', { wires: [['n2']] })
            RED.nodes._all = [node, makeNode('n2', 'debug')]

            // Watch for acquire — should never be called.
            let acquireCalled = false
            const origAcquire = scheduler.acquire.bind(scheduler)
            scheduler.acquire = (...args) => {
                acquireCalled = true
                return origAcquire(...args)
            }

            agent._request(node)

            acquireCalled.should.be.false()
        })

        it('should allow LLM call when output port is empty', function () {
            const agent = new NextNodeAgent()
            agent.init({ RED, assistantOptions: { enabled: true }, scheduler })

            const node = makeNode('n1', 'function', { wires: [[], []] })
            RED.nodes._all = [node]

            let acquireCalled = false
            const origAcquire = scheduler.acquire.bind(scheduler)
            scheduler.acquire = (...args) => {
                acquireCalled = true
                return origAcquire(...args)
            }

            // Emit selection to trigger _request.
            RED.events.emit('view:selection-changed', { nodes: [node] })

            acquireCalled.should.be.true()
        })
    })
})

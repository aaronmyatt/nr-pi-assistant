/// <reference types="should" />
'use strict'
require('should')
const sinon = require('sinon')

const [major] = process.versions.node.split('.').map(Number)
const describeMain = major < 20 ? describe.skip : describe

describeMain('AgentScheduler', function () {
    let AgentScheduler

    beforeEach(async () => {
        const module = await import('../../../resources/agentScheduler.js')
        AgentScheduler = module.AgentScheduler
    })

    function makeNode (id, type = 'inject', overrides = {}) {
        return { id, type, wires: [], ...overrides }
    }

    // ── register ────────────────────────────────────────────────────────────

    it('should register an agent', function () {
        const s = new AgentScheduler()
        s.register('test-agent')
        s.hasAgent('test-agent').should.be.true()
    })

    it('should allow re-registration (overwrite)', function () {
        const s = new AgentScheduler()
        s.register('agent', { maxAttempts: 5 })
        // Should not throw
        s.register.should.not.throw({ maxAttempts: 10 })
    })

    // ── basic acquire ───────────────────────────────────────────────────────

    it('should allow a first request', function () {
        const s = new AgentScheduler()
        s.register('test')
        const permit = s.acquire('test', { node: makeNode('n1') })
        permit.allowed.should.be.true()
        permit.fromCache.should.be.false()
        permit.transactionId.should.containEql('test-n1-')
    })

    it('should reject when agent is not registered', function () {
        const s = new AgentScheduler()
        const permit = s.acquire('unknown', { node: makeNode('n1') })
        permit.allowed.should.be.false()
        permit.reason.should.containEql('not registered')
    })

    it('should reject when node has no id', function () {
        const s = new AgentScheduler()
        s.register('test')
        const permit = s.acquire('test', { node: { type: 'inject' } })
        permit.allowed.should.be.false()
    })

    // ── in-flight dedup ─────────────────────────────────────────────────────

    it('should deduplicate in-flight requests', function () {
        const s = new AgentScheduler()
        s.register('test')

        const p1 = s.acquire('test', { node: makeNode('n1') })
        p1.allowed.should.be.true()

        const p2 = s.acquire('test', { node: makeNode('n1') })
        p2.allowed.should.be.false()
        p2.reason.should.equal('already in-flight')
    })

    it('should allow request after release', function () {
        const s = new AgentScheduler()
        s.register('test')

        s.acquire('test', { node: makeNode('n1') })
        s.release('test', 'n1')

        const p2 = s.acquire('test', { node: makeNode('n1') })
        p2.allowed.should.be.true()
    })

    it('should isolate in-flight state between agents', function () {
        const s = new AgentScheduler()
        s.register('agent-a')
        s.register('agent-b')

        s.acquire('agent-a', { node: makeNode('n1') })

        // Different agent, same node — should be allowed
        const p2 = s.acquire('agent-b', { node: makeNode('n1') })
        p2.allowed.should.be.true()
    })

    // ── attempt cap ─────────────────────────────────────────────────────────

    it('should enforce attempt cap', function () {
        const s = new AgentScheduler()
        s.register('test', { maxAttempts: 2 })

        s.acquire('test', { node: makeNode('n1') }); s.release('test', 'n1')
        s.acquire('test', { node: makeNode('n1') }); s.release('test', 'n1')

        const p3 = s.acquire('test', { node: makeNode('n1') })
        p3.allowed.should.be.false()
        p3.reason.should.containEql('max attempts')
    })

    it('should track attempts per node', function () {
        const s = new AgentScheduler()
        s.register('test', { maxAttempts: 3 })

        s.acquire('test', { node: makeNode('n1') })
        s.attemptCount('test', 'n1').should.equal(1)

        s.acquire('test', { node: makeNode('n2') })
        s.attemptCount('test', 'n2').should.equal(1)
        s.attemptCount('test', 'n1').should.equal(1)
    })

    // ── cache ───────────────────────────────────────────────────────────────

    it('should serve from cache when fingerprint matches', function () {
        const s = new AgentScheduler()
        s.register('test')

        const node = makeNode('n1', 'inject', { topic: 'trigger' })

        // First request — allowed
        const p1 = s.acquire('test', { node })
        p1.allowed.should.be.true()
        p1.fromCache.should.be.false()

        // Commit a result
        s.commit('test', 'n1', ['hint1', 'hint2'], { node })

        // Second request with same config — cache hit
        const p2 = s.acquire('test', { node })
        p2.allowed.should.be.true()
        p2.fromCache.should.be.true()
        p2.cachedResult.should.deepEqual(['hint1', 'hint2'])
    })

    it('should evict cache when fingerprint changes', function () {
        const s = new AgentScheduler()
        s.register('test')

        const node = makeNode('n1', 'inject', { topic: 'trigger' })

        s.acquire('test', { node })
        s.commit('test', 'n1', ['old'], { node })

        // Change config
        node.topic = 'new-trigger'

        const p2 = s.acquire('test', { node })
        p2.allowed.should.be.true()
        p2.fromCache.should.be.false()
    })

    // ── isInflight / introspection ──────────────────────────────────────────

    it('should report in-flight status', function () {
        const s = new AgentScheduler()
        s.register('test')

        s.isInflight('test', 'n1').should.be.false()
        s.acquire('test', { node: makeNode('n1') })
        s.isInflight('test', 'n1').should.be.true()
        s.release('test', 'n1')
        s.isInflight('test', 'n1').should.be.false()
    })

    it('should report attempt count', function () {
        const s = new AgentScheduler()
        s.register('test')

        s.attemptCount('test', 'n1').should.equal(0)
        s.acquire('test', { node: makeNode('n1') })
        s.attemptCount('test', 'n1').should.equal(1)
    })

    // ── reset ───────────────────────────────────────────────────────────────

    it('should reset all state for an agent', function () {
        const s = new AgentScheduler()
        s.register('test', { maxAttempts: 5 })

        s.acquire('test', { node: makeNode('n1') })
        s.commit('test', 'n1', ['cached'], { node: makeNode('n1') })

        s.reset('test')

        s.isInflight('test', 'n1').should.be.false()
        s.attemptCount('test', 'n1').should.equal(0)
        should(s.getCache('test', 'n1')).be.null()
    })
})

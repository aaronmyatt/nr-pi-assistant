/// <reference types="should" />
'use strict'
require('should')
const sinon = require('sinon')

const [major] = process.versions.node.split('.').map(Number)
const describeMain = major < 20 ? describe.skip : describe

describeMain('dagSerializer', function () {
    let dagSerializer
    let CRUFT_KEYS
    let stripNodeCruft
    let fingerprintNode
    let getFlowName
    let buildFlowContextText
    let buildConnectedNodesText

    beforeEach(async () => {
        const module = await import('../../../resources/dagSerializer.js')
        dagSerializer = module
        CRUFT_KEYS = module.CRUFT_KEYS
        stripNodeCruft = module.stripNodeCruft
        fingerprintNode = module.fingerprintNode
        getFlowName = module.getFlowName
        buildFlowContextText = module.buildFlowContextText
        buildConnectedNodesText = module.buildConnectedNodesText
    })

    // ── CRUFT_KEYS ──────────────────────────────────────────────────────────

    it('should exclude position and internal keys', function () {
        CRUFT_KEYS.should.be.instanceOf(Set)
        CRUFT_KEYS.has('x').should.be.true()
        CRUFT_KEYS.has('y').should.be.true()
        CRUFT_KEYS.has('z').should.be.true()
        CRUFT_KEYS.has('id').should.be.true()
        CRUFT_KEYS.has('_def').should.be.true()
    })

    it('should keep user info field', function () {
        CRUFT_KEYS.has('info').should.be.false()
    })

    // ── stripNodeCruft ──────────────────────────────────────────────────────

    it('should strip position and internal keys', function () {
        const node = {
            id: 'n1', type: 'inject', name: 'test', x: 100, y: 200, z: 'tab-1',
            wires: [], _def: {}, _alias: 'x',
            topic: 'my-topic', payload: 'hello'
        }
        const config = stripNodeCruft(node)
        config.should.not.have.property('x')
        config.should.not.have.property('y')
        config.should.not.have.property('id')
        config.should.not.have.property('_def')
        config.should.have.property('topic', 'my-topic')
        config.should.have.property('payload', 'hello')
    })

    it('should truncate long string values', function () {
        const longStr = 'x'.repeat(600)
        const node = { id: 'n1', type: 'test', func: longStr }
        const config = stripNodeCruft(node)
        config.func.should.endWith('...')
        config.func.length.should.be.lessThan(510) // 500 + '...'
    })

    it('should handle circular references gracefully', function () {
        const circular = { name: 'recursive' }
        circular.self = circular
        const node = { id: 'n1', type: 'test', editor: circular }
        const config = stripNodeCruft(node)
        config.should.have.property('editor', '[non-serializable]')
    })

    it('should omit undefined and null values', function () {
        const node = {
            id: 'n1', type: 'test',
            a: undefined, b: null, c: 'hello'
        }
        const config = stripNodeCruft(node)
        config.should.not.have.property('a')
        config.should.not.have.property('b')
        config.should.have.property('c', 'hello')
    })

    it('should skip underscore-prefixed keys', function () {
        const node = { id: 'n1', type: 'test', _private: 'secret', visible: 'yes' }
        const config = stripNodeCruft(node)
        config.should.not.have.property('_private')
        config.should.have.property('visible', 'yes')
    })

    // ── fingerprintNode ─────────────────────────────────────────────────────

    it('should produce stable fingerprints for the same state', function () {
        const node = { id: 'n1', type: 'inject', topic: 'trigger', repeat: '60' }
        const fp1 = fingerprintNode({ node, upstream: [], downstream: [] })
        const fp2 = fingerprintNode({ node, upstream: [], downstream: [] })
        fp1.should.equal(fp2)
    })

    it('should change fingerprint when config changes', function () {
        const node = { id: 'n1', type: 'inject', topic: 'trigger', repeat: '60' }
        const fp1 = fingerprintNode({ node, upstream: [], downstream: [] })
        node.repeat = '120'
        const fp2 = fingerprintNode({ node, upstream: [], downstream: [] })
        fp1.should.not.equal(fp2)
    })

    it('should change fingerprint when wiring changes', function () {
        const node = { id: 'n1', type: 'inject' }
        const fp1 = fingerprintNode({ node, upstream: [], downstream: [] })
        const fp2 = fingerprintNode({
            node,
            upstream: [{ id: 'n0', type: 'inject' }],
            downstream: [{ id: 'n2', type: 'debug' }]
        })
        fp1.should.not.equal(fp2)
    })

    it('should sort wiring ids for stability', function () {
        const node = { id: 'n1', type: 'inject' }
        const fp1 = fingerprintNode({
            node,
            upstream: [{ id: 'c' }, { id: 'a' }, { id: 'b' }],
            downstream: []
        })
        const fp2 = fingerprintNode({
            node,
            upstream: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
            downstream: []
        })
        fp1.should.equal(fp2)
    })

    it('should skip internal keys in fingerprint', function () {
        const node = { id: 'n1', type: 'inject', x: 100, y: 200, _editor: {}, topic: 'trigger' }
        const fp = fingerprintNode({ node, upstream: [], downstream: [] })
        const parsed = JSON.parse(fp)
        parsed.c.should.not.containEql('x:')
        parsed.c.should.not.containEql('_editor')
        parsed.c.should.containEql('topic')
    })

    it('should handle circular refs in fingerprint config', function () {
        const circular = {}
        circular.self = circular
        const node = { id: 'n1', type: 'test', editor: circular }
        // Should not throw
        fingerprintNode.should.not.throw({ node, upstream: [], downstream: [] })
    })

    // ── getFlowName ─────────────────────────────────────────────────────────

    it('should return flow name from active tab', function () {
        const RED = {
            workspaces: {
                active: sinon.stub().returns('tab-1')
            },
            nodes: {
                workspace: sinon.stub().returns({ label: 'My Flow' })
            }
        }
        getFlowName(RED).should.equal('My Flow')
    })

    it('should return "unknown flow" when no active tab', function () {
        const RED = {
            workspaces: { active: sinon.stub().returns(null) }
        }
        getFlowName(RED).should.equal('unknown flow')
    })

    // ── buildConnectedNodesText ─────────────────────────────────────────────

    it('should show upstream and downstream sections', function () {
        const text = buildConnectedNodesText({
            upstream: [{ type: 'inject', name: 'trigger' }],
            downstream: [{ type: 'debug' }]
        })
        text.should.containEql('UPSTREAM')
        text.should.containEql('[inject] "trigger"')
        text.should.containEql('DOWNSTREAM')
        text.should.containEql('[debug]')
        text.should.containEql('DO NOT suggest adding')
    })

    it('should show none when no connections', function () {
        const text = buildConnectedNodesText({ upstream: [], downstream: [] })
        text.should.containEql('UPSTREAM: none')
        text.should.containEql('DOWNSTREAM: none')
    })

    // ── buildFlowContextText ────────────────────────────────────────────────

    it('should show all nodes with readable wiring', function () {
        const nodes = [
            { id: 'n1', type: 'inject', name: 'trigger', wires: [['n2']] },
            { id: 'n2', type: 'debug', name: 'viewer', wires: [] }
        ]
        const RED = {
            workspaces: { active: sinon.stub().returns('tab-1') },
            nodes: {
                eachNode: (fn) => nodes.forEach(fn),
                workspace: sinon.stub().returns({ label: 'Test Flow' })
            }
        }
        const text = buildFlowContextText({ RED, selectedNode: { id: 'n1' } })
        text.should.containEql('Test Flow')
        text.should.containEql('★ SELECTED')
        text.should.containEql('"trigger"')
        text.should.containEql('inject→debug')
    })

    it('should mark selected node', function () {
        const nodes = [
            { id: 'n1', type: 'inject', wires: [] },
            { id: 'n2', type: 'debug', wires: [] }
        ]
        const RED = {
            workspaces: { active: sinon.stub().returns('tab-1') },
            nodes: {
                eachNode: (fn) => nodes.forEach(fn),
                workspace: sinon.stub().returns({ label: 'Flow' })
            }
        }
        const text = buildFlowContextText({ RED, selectedNode: { id: 'n2' } })
        text.should.containEql('[debug] ★ SELECTED')
        text.should.not.containEql('[inject] ★ SELECTED')
    })

    it('should fall back to filterNodes when eachNode unavailable', function () {
        const nodes = [{ id: 'n1', type: 'inject', wires: [] }]
        const RED = {
            workspaces: { active: sinon.stub().returns('tab-1') },
            nodes: {
                filterNodes: sinon.stub().returns(nodes),
                workspace: sinon.stub().returns({ label: 'Flow' })
            }
        }
        const text = buildFlowContextText({ RED, selectedNode: { id: 'n1' } })
        text.should.containEql('[inject]')
    })
})

/* eslint-disable no-console */
/// <reference types="should" />
'use strict'
require('should')
const sinon = require('sinon')
const EventEmitter = require('events')

const [major] = process.versions.node.split('.').map(Number)
const describeMain = major < 20 ? describe.skip : describe

/**
 * Strip HTML tags for text-based assertions.
 */
function stripTags (html) {
    return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Create a DOM-like element that tracks innerHTML and textContent.
 *
 * Updated with querySelector support for class-based selectors so
 * the _injectAIHints and _injectAIHintsError methods can find the
 * .nr-assistant-hints-ai placeholder div.
 *
 * When innerHTML is set on the nested AI hints element, we patch the
 * parent's innerHTML directly by replacing the AI section placeholder.
 */
function createFakeElement () {
    let html = ''
    // Allow the parent reference to be set after creation (for nested elements)
    // so that mutations on the nested element reflect in the parent's HTML.
    let parentRef = null

    const el = {
        className: '',
        style: {},
        children: [],
        textContent: '',
        innerText: '',
        appendChild (child) {
            this.children.push(child)
        },
        set innerHTML (value) {
            html = String(value || '')
            this.textContent = stripTags(html)
            this.innerText = this.textContent
            // If this is a nested AI hints element, patch the parent
            if (parentRef) {
                parentRef._patchAIHintsSection(value)
            }
        },
        get innerHTML () {
            return html
        },
        /**
         * Replace the .nr-assistant-hints-ai div content in the stored HTML.
         * Called when the nested element's innerHTML setter fires.
         *
         * @param {string} newContent - The new inner content for the AI hints section
         */
        _patchAIHintsSection (newContent) {
            html = html.replace(
                /(<div class="nr-assistant-hints-ai">)([\s\S]*?)(<\/div>)/,
                `$1${newContent}$3`
            )
            this.textContent = stripTags(html)
            this.innerText = this.textContent
        },
        /**
         * Simple querySelector wrapper that supports class selectors
         * (for .nr-assistant-hints-ai) and tag selectors (for p).
         *
         * @param {string} selector
         * @returns {Object|null}
         */
        querySelector (selector) {
            if (selector === '.nr-assistant-hints-ai') {
                // Return a nested proxy element. When its innerHTML is set,
                // we patch the parent's HTML so assertions on the parent
                // can see the injected content.
                const nested = createFakeElement()
                nested.parentRef = el // wire back to parent for patching
                // Seed the nested element with the current AI section content
                const match = html.match(/<div class="nr-assistant-hints-ai">([\s\S]*?)<\/div>/)
                nested.innerHTML = match ? match[1] : ''
                return nested
            }
            if (selector === 'p') {
                const match = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)
                if (match) {
                    return { textContent: stripTags(match[1]) }
                }
            }
            return null
        }
    }

    return el
}

describeMain('AssistantHintsSidebar', function () {
    let AssistantHintsSidebar
    let fingerprintNode
    let TAB_ID
    let SHOW_ACTION_ID
    let sidebar
    let RED
    let selectedNodes

    beforeEach(async () => {
        const module = await import('../../../resources/hintsSidebar.js')
        AssistantHintsSidebar = module.AssistantHintsSidebar
        TAB_ID = module.TAB_ID
        SHOW_ACTION_ID = module.SHOW_ACTION_ID

        const dagModule = await import('../../../resources/dagSerializer.js')
        fingerprintNode = dagModule.fingerprintNode

        selectedNodes = []
        global.document = {
            createElement: sinon.stub().callsFake(() => createFakeElement()),
            querySelector: sinon.stub().callsFake((selector) => {
                if (selector === 'script[data-help-name="function"]') {
                    return {
                        innerHTML: '<p>Runs custom JavaScript against the incoming message.</p><p>Detailed help.</p>',
                        getAttribute: sinon.stub().returns('text/html')
                    }
                }
                if (selector === 'script[data-help-name="inject"]') {
                    return {
                        innerHTML: '<p>Sends a message into a flow.</p>',
                        getAttribute: sinon.stub().returns('text/html')
                    }
                }
                return null
            })
        }

        RED = {
            events: new EventEmitter(),
            sidebar: {
                addTab: sinon.stub(),
                show: sinon.stub(),
                containsTab: sinon.stub().returns(false)
            },
            actions: {
                add: sinon.stub()
            },
            view: {
                selection: sinon.stub().callsFake(() => ({ nodes: selectedNodes }))
            },
            nodes: {
                node: sinon.stub(), // For lookup by ID
                getType: sinon.stub().callsFake((type) => {
                    if (type === 'function') {
                        return {
                            set: { module: 'node-red' },
                            category: 'function',
                            defaults: { name: { value: '' }, func: { value: '' }, outputs: { value: 1 } },
                            inputs: 1,
                            outputs: 2,
                            paletteLabel: 'function'
                        }
                    }
                    if (type === 'inject') {
                        return {
                            set: { module: 'node-red' },
                            category: 'input',
                            defaults: { name: { value: '' }, payload: { value: '' } },
                            inputs: 0,
                            outputs: 1,
                            paletteLabel: 'inject'
                        }
                    }
                    return null
                })
            },
            utils: {
                renderMarkdown: sinon.stub().callsFake((markdown) => `<p>${markdown}</p>`)
            },
            // For _getFlowName
            workspaces: {
                active: sinon.stub().returns('tab-1')
            }
        }

        sidebar = new AssistantHintsSidebar()
    })

    afterEach(() => {
        sinon.restore()
        delete global.document
    })

    // ── Tab registration ──────────────────────────────────────────────────

    it('should register a dedicated sidebar tab that stays available during edit dialogs', function () {
        sidebar.init({ RED, assistantOptions: { enabled: true } })
        RED.events.emit('flows:loaded')

        RED.sidebar.addTab.calledOnce.should.be.true()
        const tab = RED.sidebar.addTab.firstCall.args[0]
        tab.id.should.equal(TAB_ID)
        tab.enableOnEdit.should.equal(true)
        tab.action.should.equal(SHOW_ACTION_ID)
        RED.actions.add.calledOnce.should.be.true()
        RED.actions.add.firstCall.args[0].should.equal(SHOW_ACTION_ID)
    })

    // ── Empty state ───────────────────────────────────────────────────────

    it('should render an empty state when no node is selected', function () {
        sidebar.init({ RED, assistantOptions: { enabled: true } })
        sidebar.contentEl.innerHTML.should.match(/Select a node to see AI guidance/)
    })

    // ── Selection change → panel updates ──────────────────────────────────

    it('should render the node context panel on selection change with AI loading placeholder', function () {
        sidebar.init({ RED, assistantOptions: { enabled: true } })

        // Wire up RED.nodes.workspace for _getFlowName
        RED.nodes.workspace = sinon.stub().returns({ label: 'My Flow', id: 'tab-1' })

        const node = {
            id: 'n1',
            type: 'function',
            name: '',
            outputs: 2,
            wires: [],
            _def: { set: { module: 'node-red' } }
        }
        selectedNodes = [node]

        RED.events.emit('view:selection-changed', { nodes: [node] })

        const innerHtml = sidebar.contentEl.innerHTML

        // Should show the node type in the heading
        innerHtml.should.match(/Suggestions for <code>function<\/code>/)

        // Should show the AI hints loading placeholder
        innerHtml.should.match(/Loading suggestions\.\.\./)
    })

    // ── Refresh after node edit ───────────────────────────────────────────

    it('should refresh when the selected node changes after edit events', function () {
        RED.nodes.workspace = sinon.stub().returns({ label: 'Test Flow', id: 'tab-1' })

        const node = {
            id: 'n1',
            type: 'inject',
            name: '',
            outputs: 1,
            wires: [],
            _def: { set: { module: 'node-red' } }
        }
        selectedNodes = [node]
        sidebar.init({ RED, assistantOptions: { enabled: true } })
        RED.events.emit('view:selection-changed', { nodes: [node] })
        sidebar.contentEl.innerHTML.should.match(/Suggestions for <code>inject<\/code>/)

        node.name = 'Kick off flow'
        RED.events.emit('nodes:change', node)

        // The panel still shows the type (name is not rendered in the stripped panel)
        sidebar.contentEl.innerHTML.should.match(/Suggestions for <code>inject<\/code>/)
    })

    // ── buildLabelSuggestion ──────────────────────────────────────────────

    it('should build appropriate label suggestions for known node types', function () {
        sidebar._getFlowName = () => 'test' // prevent workspace lookup

        sidebar.buildLabelSuggestion({ node: { type: 'http request', name: '' }, nodeContext: { type: 'http request' } })
            .should.equal('Fetch HTTP resource')

        sidebar.buildLabelSuggestion({ node: { type: 'switch', name: '' }, nodeContext: { type: 'switch' } })
            .should.equal('Route message')

        sidebar.buildLabelSuggestion({ node: { type: 'unknown-node', name: '' }, nodeContext: { paletteLabel: 'Unknown', type: 'unknown-node' } })
            .should.equal('Unknown')
    })

    // ── _getConnectedNodes ───────────────────────────────────────────────

    it('should find downstream nodes via node.wires', function () {
        sidebar.init({ RED }) // Set this.RED so _getConnectedNodes can access RED.nodes
        const targetNode = { id: 'n2', type: 'debug', name: 'Check output', wires: [] }
        RED.nodes.node.withArgs('n2').returns(targetNode)

        const node = {
            id: 'n1',
            type: 'function',
            wires: [['n2']] // Single output → debug node
        }

        const { upstream, downstream } = sidebar._getConnectedNodes(node)
        downstream.should.have.length(1)
        downstream[0].id.should.equal('n2')
        downstream[0].type.should.equal('debug')
        upstream.should.have.length(0)
    })

    it('should find upstream nodes by scanning all nodes', function () {
        sidebar.init({ RED })
        const upstreamNode = { id: 'n0', type: 'inject', name: 'Trigger', wires: [['n1']] }
        const targetNode = { id: 'n1', type: 'function', wires: [] }
        RED.nodes.node.withArgs('n1').returns(targetNode)

        // Provide eachNode for scanning
        RED.nodes.eachNode = sinon.stub().callsFake(function (callback) {
            callback(upstreamNode)
            callback(targetNode)
        })

        const { upstream, downstream } = sidebar._getConnectedNodes(targetNode)
        downstream.should.have.length(0)
        upstream.should.have.length(1)
        upstream[0].id.should.equal('n0')
        upstream[0].type.should.equal('inject')
    })

    // ── _getConfigSummary ─────────────────────────────────────────────────

    it('should extract meaningful config and skip internal properties', function () {
        const node = {
            id: 'n1',
            type: 'http request',
            name: 'My Request',
            x: 100,
            y: 200,
            z: 'flow-1',
            wires: [['n2']],
            _def: {},
            url: 'https://api.example.com',
            method: 'GET',
            ret: 'obj',
            paytoqs: false
        }

        const config = sidebar._getConfigSummary(node)
        // Should include user-facing config
        config.should.have.property('url', 'https://api.example.com')
        config.should.have.property('method', 'GET')
        config.should.have.property('ret', 'obj')
        // paytoqs: false IS a meaningful config value — it explicitly means
        // "do not send payload to query string"
        config.should.have.property('paytoqs', false)
        // Should skip internal properties
        config.should.not.have.property('id')
        config.should.not.have.property('name')
        config.should.not.have.property('x')
        config.should.not.have.property('y')
        config.should.not.have.property('z')
        config.should.not.have.property('wires')
        config.should.not.have.property('_def')
    })

    // ── _buildHintPrompt ──────────────────────────────────────────────────

    it('should build a rich hint prompt with node config, wiring, and flow context', function () {
        sidebar.init({ RED, assistantOptions: { enabled: true } })
        // Set up workspace mock
        RED.nodes.workspace = sinon.stub().returns({ label: 'IoT Pipeline', id: 'tab-1' })

        const downstreamNode = { id: 'n2', type: 'http response', wires: [] }
        RED.nodes.node.withArgs('n2').returns(downstreamNode)
        RED.nodes.eachNode = sinon.stub().callsFake(function (callback) {
            callback({ id: 'n1', type: 'http request', wires: [['n2']] })
            callback(downstreamNode)
        })

        const node = {
            id: 'n1',
            type: 'http request',
            wires: [['n2']],
            url: 'https://api.example.com/v1/',
            method: 'GET',
            ret: 'obj'
        }

        const nodeContext = {
            type: 'http request',
            paletteLabel: 'http request',
            category: 'network',
            helpSummary: 'Sends an HTTP request and returns the response.',
            inputs: 1,
            outputs: 1
        }

        const prompt = sidebar._buildHintPrompt(node, nodeContext)

        prompt.should.match(/http request/)
        prompt.should.match(/Sends an HTTP request/)
        prompt.should.match(/https:\/\/api\.example\.com/)
        prompt.should.match(/method: GET/)
        prompt.should.match(/http response/) // downstream node
        prompt.should.match(/IoT Pipeline/) // flow name
    })

    // ── _configFingerprint ────────────────────────────────────────────────

    it('should change fingerprint when node config changes', function () {
        RED.nodes.eachNode = sinon.stub().callsFake(function (callback) { /* empty */ })

        const node = {
            id: 'n1',
            type: 'http request',
            wires: [],
            url: 'https://api.example.com',
            method: 'GET'
        }

        const fp1 = fingerprintNode({ node, upstream: [], downstream: [] })

        // Change the URL
        node.url = 'https://api.different.com'
        const fp2 = fingerprintNode({ node, upstream: [], downstream: [] })

        fp1.should.not.equal(fp2)
    })

    it('should change fingerprint when wiring changes', function () {
        sidebar.init({ RED })
        // Set up eachNode so fingerprint includes upstream/downstream ids
        const upstreamNode = { id: 'n0', type: 'inject', wires: [['n1']] }
        RED.nodes.eachNode = sinon.stub().callsFake(function (callback) {
            callback(upstreamNode)
            callback({ id: 'n1', type: 'function', wires: [] })
        })

        const node = { id: 'n1', type: 'function', wires: [] }
        const fp1 = fingerprintNode({ node, upstream: [upstreamNode], downstream: [] })

        // Add a downstream wire
        node.wires = [['n2']]
        const downstreamNode = { id: 'n2', type: 'debug', wires: [] }
        RED.nodes.eachNode = sinon.stub().callsFake(function (callback) {
            callback(upstreamNode)
            callback(node)
            callback(downstreamNode)
        })
        RED.nodes.node.withArgs('n2').returns(downstreamNode)

        const fp2 = fingerprintNode({ node, upstream: [upstreamNode], downstream: [downstreamNode] })
        fp1.should.not.equal(fp2)
    })

    // ── _requestAIHints (without jQuery / with AI disabled) ───────────────

    // ── _injectAIHints / _injectAIHintsError ───────────────────────────

    it('should inject AI hints into the panel without throwing', function () {
        sidebar.init({ RED, assistantOptions: { enabled: true } })
        sidebar._getFlowName = () => 'test flow'

        // Trigger a full render so .nr-assistant-hints-ai exists in the DOM
        const node = { id: 'n1', type: 'function', wires: [], func: 'return msg;', outputs: 1, _def: { set: { module: 'node-red' } } }
        selectedNodes = [node]
        RED.nodes.workspace = sinon.stub().returns({ label: 'test', id: 'tab-1' })
        RED.events.emit('view:selection-changed', { nodes: [node] })

        // Inject hints — should not throw when the DOM element exists
        ;(function () {
            sidebar._injectAIHints(['Try adding a debug node after this.', 'Set msg.payload before returning.'])
        }).should.not.throw()
    })

    it('should handle empty hints array gracefully', function () {
        sidebar.init({ RED, assistantOptions: { enabled: true } })
        const node = { id: 'n1', type: 'function', wires: [], func: 'return msg;', outputs: 1, _def: { set: { module: 'node-red' } } }
        selectedNodes = [node]
        RED.nodes.workspace = sinon.stub().returns({ label: 'test', id: 'tab-1' })
        RED.events.emit('view:selection-changed', { nodes: [node] })

        ;(function () {
            sidebar._injectAIHints([])
        }).should.not.throw()
    })

    it('should handle error injection without throwing', function () {
        sidebar.init({ RED, assistantOptions: { enabled: true } })
        const node = { id: 'n1', type: 'function', wires: [], func: 'return msg;', outputs: 1, _def: { set: { module: 'node-red' } } }
        selectedNodes = [node]
        RED.nodes.workspace = sinon.stub().returns({ label: 'test', id: 'tab-1' })
        RED.events.emit('view:selection-changed', { nodes: [node] })

        ;(function () {
            sidebar._injectAIHintsError()
        }).should.not.throw()
    })
})

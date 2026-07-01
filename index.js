module.exports = (RED) => {
    const assistant = require('./lib/assistant.js')
    const settings = require('./lib/settings.js')
    RED.plugins.registerPlugin('pi-assistant', {
        type: 'assistant',
        name: 'Node-RED Expert Plugin',
        icon: 'font-awesome/fa-magic',
        settings: {
            '*': { exportable: true }
        },
        onadd: async function () {
            try {
                const assistantSettings = await settings.getSettings(RED)
                if (!assistant.isInitialized && !assistant.isLoading) {
                    assistant.init(RED, assistantSettings).then(() => {
                        // All good, the assistant is initialized.
                        // Any info messages made during initialization are logged in the assistant module
                    }).catch((error) => {
                        console.error(error)
                        RED.log.error('Failed to initialize Node-RED AI Assistant Plugin:', error)
                    })
                }
            } catch (error) {
                console.error(error)
                RED.log.error('Failed to initialize Node-RED AI Assistant Plugin:', error)
            }
        }
    })
}

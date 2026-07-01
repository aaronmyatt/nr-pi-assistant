/**
 * Plugin settings resolver for the Node-RED Assistant plugin.
 *
 * Reads settings from RED.settings.flowfuse.assistant (legacy key) or
 * RED.settings.nrAssistant (preferred). No longer requires a FlowFuse token
 * or account — the plugin is enabled when a backend is configured.
 *
 * @typedef {Object} AssistantSettings
 * @property {boolean} enabled - Whether the Assistant is enabled
 * @property {string} backend - Backend type: 'flowfuse', 'pi-rpc', or 'pi-ai' (default: 'flowfuse')
 * @property {string} [url] - Backend URL (required for flowfuse backend)
 * @property {string} [token] - Auth token (only needed for flowfuse backend)
 * @property {string} [model] - Model ID for pi backends (e.g. 'deepseek-fast-v4')
 * @property {string} [provider] - Provider name for pi backends (e.g. 'deepseek')
 * @property {number} requestTimeout - Request timeout in ms (default: 60000)
 * @property {Object} [got] - got HTTP client instance (for testing)
 * @property {Object} completions - Settings for completions
 * @property {boolean} completions.enabled - Whether completions are enabled
 * @property {string} [completions.modelUrl] - URL to ML model (ONNX, for flowfuse backend only)
 * @property {string} [completions.vocabularyUrl] - URL to vocabulary lookup (ONNX, for flowfuse backend only)
 * @property {boolean} completions.inlineEnabled - Whether inline (FIM) completions are enabled
 * @property {Object} mcp - Settings for Model Context Protocol
 * @property {boolean} mcp.enabled - Whether MCP is enabled
 * @property {Object} tables - Settings for tables
 * @property {boolean} tables.enabled - Whether tables feature is enabled
 * @property {Object} inlineCompletions - Settings for inline completions
 * @property {boolean} inlineCompletions.enabled - Whether inline completions are enabled
 */

module.exports = {
    /**
     * Get the Assistant settings from the RED instance.
     *
     * Resolved from RED.settings.flowfuse.assistant (backward-compatible)
     * or RED.settings.nrAssistant (preferred new key). The old token-gated
     * "standalone" mode has been removed — the plugin is enabled when
     * settings.enabled is true and a backend is configured.
     *
     * @param {Object} RED - The RED instance
     * @returns {AssistantSettings} - The Assistant settings
     */
    getSettings: async (RED) => {
        // Support both legacy flowfuse key and new nrAssistant key
        const assistantSettings = RED.settings.nrAssistant?.assistant ||
                                  RED.settings.flowfuse?.assistant ||
                                  RED.settings.flowforge?.assistant ||
                                  {}

        // Apply defaults
        const settings = {
            enabled: assistantSettings.enabled !== false, // default enabled
            backend: assistantSettings.backend || 'flowfuse',
            url: assistantSettings.url || 'https://app.flowfuse.com/api/v1/assistant/',
            token: assistantSettings.token || null,
            model: assistantSettings.model || null,
            provider: assistantSettings.provider || 'deepseek',
            requestTimeout: assistantSettings.requestTimeout || 60000,
            got: assistantSettings.got || null,
            mcp: {
                enabled: assistantSettings.mcp?.enabled !== false
            },
            completions: {
                enabled: assistantSettings.completions?.enabled !== false,
                modelUrl: assistantSettings.completions?.modelUrl || null,
                vocabularyUrl: assistantSettings.completions?.vocabularyUrl || null,
                inlineEnabled: assistantSettings.completions?.inlineEnabled !== false
            },
            tables: {
                enabled: false // Tables is FlowFuse-only; disabled by default
            },
            inlineCompletions: {
                enabled: assistantSettings.inlineCompletions?.enabled !== false
            }
        }

        return settings
    }
}

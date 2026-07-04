# node-red-contrib-pi-assistant

**Node-RED AI Assistant** with a direct DeepSeek backend — a self-hosted, bring-your-own-key AI plugin for Node-RED.

Originally forked from [FlowFuse/nr-assistant](https://github.com/FlowFuse/nr-assistant) (Apache-2.0).

## Features

- **Function Builder** (⌘⌥F) — describe a function and get generated JavaScript code placed on the canvas
- **JSON / CSS / HTML Generator** — generate data and styles inline in the Monaco editor
- **Inline Completions (FIM)** — fill-in-the-middle code suggestions for function nodes
- **Explain Flows** (⌘⌥E) — select nodes and get an AI explanation of what they do
- **Next-Node Autocomplete** — heuristic suggestions (e.g., `join` after `split`, `link out` after `link in`) with LLM-powered multi-step predictions

## Install

```bash
npm install node-red-contrib-pi-assistant
```

Or install from this repo:

```bash
cd ~/.node-red
npm install /path/to/node-red-contrib-pi-assistant
```

## Configuration

### API Key (required)

Set your DeepSeek API key as an environment variable:

```bash
export DEEPSEEK_API_KEY=sk-your-key-here
```

### Node-RED Settings (`settings.js`)

```js
flowfuse: {
    assistant: {
        enabled: true,
        backend: 'deepseek',         // direct DeepSeek API backend
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        requestTimeout: 30000,
        completions: {
            enabled: true,
            inlineEnabled: true
        },
        mcp: { enabled: true }
    }
}
```

### Backend Options

| Backend | Description |
|---------|-------------|
| `deepseek` | Direct DeepSeek API transport. Uses `DEEPSEEK_API_KEY` from the server environment. Recommended. |
| `flowfuse` | Legacy FlowFuse Cloud backend. Requires a FlowFuse account and token. Optional compatibility path. |

## Architecture

```
editor → POST /nr-assistant/:method → handler → AiBackend.run() → DeepSeek API
```

The plugin uses a pluggable `AiBackend` interface (`lib/ai/backend.js`). Backend implementations live in `lib/ai/backends/`:
- `deepseek.js` — direct DeepSeek API backend
- `flowfuse.js` — original FlowFuse HTTP backend (compatibility/parity testing)

## Requirements

- Node-RED >= 4.1
- Node.js >= 20
- A DeepSeek API key

## Privacy

Data is sent directly to DeepSeek from the Node-RED plugin. No data goes to FlowFuse unless you explicitly choose the legacy FlowFuse backend. Your API key stays in your server environment.

## License

Apache-2.0 — original FlowFuse/nr-assistant code preserved with attribution.


## Development

```bash
npm install
npm test        # 452 tests
npm run lint    # ESLint
```

Original FlowFuse source preserved as a git submodule at `flowfuse-original/` for reference.

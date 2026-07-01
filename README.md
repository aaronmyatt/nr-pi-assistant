# node-red-contrib-pi-assistant

**Node-RED AI Assistant** powered by [pi](https://github.com/earendil-works/pi) — a self-hosted, bring-your-own-key AI plugin for Node-RED.

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

Set your provider's API key as an environment variable:

```bash
# DeepSeek (default provider)
export DEEPSEEK_API_KEY=sk-your-key-here

# Or: OpenAI, Anthropic, Google, etc.
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
```

### Node-RED Settings (`settings.js`)

```js
flowfuse: {
    assistant: {
        enabled: true,
        backend: 'pi-rpc',           // 'pi-rpc' (default) or 'flowfuse' (legacy)
        provider: 'deepseek',        // LLM provider name
        model: null,                 // Model ID (null = provider default)
        requestTimeout: 60000,       // Request timeout in ms
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
| `pi-rpc` | Spawns `pi --mode rpc` subprocess. Uses provider API keys from env vars. **Default.** |
| `flowfuse` | Legacy FlowFuse Cloud backend. Requires a FlowFuse account and token. Disabled by default. |

## Architecture

```
editor → POST /nr-assistant/:method → handler → AiBackend.run() → pi --mode rpc → LLM provider
```

The plugin uses a pluggable `AiBackend` interface (`lib/ai/backend.js`). Backend implementations live in `lib/ai/backends/`:
- `pi-rpc.js` — pi subprocess via `@earendil-works/pi-coding-agent` RpcClient
- `flowfuse.js` — original FlowFuse HTTP backend (parity testing)

## Requirements

- Node-RED >= 4.1
- Node.js >= 20
- A provider API key (DeepSeek, OpenAI, Anthropic, etc.)

## Privacy

Data is sent directly to your chosen LLM provider via pi. No data goes to FlowFuse or any third party. Your API key stays in your environment.

## License

Apache-2.0 — original FlowFuse/nr-assistant code preserved with attribution.

pi integration: MIT license (earendil-works/pi).

## Development

```bash
npm install
npm test        # 446 tests
npm run lint    # ESLint
```

Original FlowFuse source preserved as a git submodule at `flowfuse-original/` for reference.

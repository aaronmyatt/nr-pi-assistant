
<!-- BACKLOG.MD GUIDELINES START -->
<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**For every user request in this project, run `backlog instructions overview` before answering or taking action.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Use the detailed guides when needed:
- `backlog instructions task-creation` for creating or splitting tasks
- `backlog instructions task-execution` for planning and implementation workflow
- `backlog instructions task-finalization` for completion and handoff

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->

<!-- NODE-RED PLUGIN DEV WORKFLOW START -->
<CRITICAL_INSTRUCTION>

## Node-RED Plugin Development Workflow

This project is a Node-RED plugin installed via `npm link` into `~/.node-red/node_modules/node-red-contrib-pi-assistant`.

### Making changes

**Server-side JS changes** (`lib/*.js`, `index.js`):
- Edit files → restart Node-RED → changes take effect immediately (require cache cleared on restart).

**Client-side HTML changes** (`index.html`, `completions.html`):
- Node-RED caches parsed HTML templates in `~/.node-red/.config.*.json`. Changes to HTML files are NOT picked up on restart alone — the cache must be cleared.

**Required restart procedure for HTML changes:**

```bash
# 1. Kill Node-RED (stop the tmux nr-server session)
# 2. Clear the registry cache
rm ~/.node-red/.config.*.json ~/.node-red/.config.*.backup 2>/dev/null

# 3. Restart Node-RED (in the tmux session)
source ~/.shell.local 2>/dev/null  # loads DEEPSEEK_API_KEY
cd ~/.node-red && node-red
```

### Testing

- `npm test` — 446 tests, 2 pending (obsolete ONNX tests)
- `npm run lint` — ESLint
- Node-RED runs in tmux session `nr-server` on port 1880
- Open `http://127.0.0.1:1880/` in Safari
- Safari: Develop → Empty Caches (Cmd+Option+E) + hard refresh after restart

### Local dev setup

The plugin is linked via `npm link`:
- Dev dir: `/Users/aaronmyatt/Development/nr-pi-assistant`
- Symlink: `~/.node-red/node_modules/node-red-contrib-pi-assistant` → dev dir
- `flowfuse-original/` is a git submodule pinning FlowFuse/nr-assistant at v0.16.0

### Key files

| File | Purpose |
|------|---------|
| `index.js` | Server-side plugin entry (CJS, Node-RED requires this) |
| `index.html` | Browser-side plugin UI (menu, code lens, doPrompt) |
| `completions.html` | Autocomplete UI (predict_next, FIM inline) |
| `lib/assistant.js` | Core singleton: handlers, MCP, backend wiring |
| `lib/ai/backend.js` | AiBackend interface |
| `lib/ai/backends/pi-rpc.js` | pi --mode rpc subprocess backend |
| `lib/ai/backends/flowfuse.js` | Legacy FlowFuse backend (parity testing) |
| `lib/ai/prompts/*.md` | System prompts for each AI feature |
| `lib/settings.js` | Plugin settings resolver |

</CRITICAL_INSTRUCTION>
<!-- NODE-RED PLUGIN DEV WORKFLOW END -->

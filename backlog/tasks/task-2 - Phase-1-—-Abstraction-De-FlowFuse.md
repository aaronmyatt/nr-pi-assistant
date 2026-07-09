---
id: TASK-2
title: Phase 1 — Abstraction + De-FlowFuse
status: Done
assignee:
  - '@aaronmyatt'
created_date: '2026-07-01 14:01'
updated_date: '2026-07-07 15:38'
labels:
  - phase-1
  - refactor
  - backend
milestone: m-0
dependencies:
  - TASK-1
priority: high
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Introduce the AiBackend abstraction, refactor handlers to use it, remove FlowFuse auth, simplify settings, and neutralize the client login UI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AiBackend interface exists at lib/ai/backend.js with run(), dispose(), ready
- [x] #2 handlePostMethodRequest, handlePostFimRequest, and explain_flow branch of handlePostPromptRequest use this.backend.run() instead of got.post
- [x] #3 Response envelope { status: 'ok', data } and error/503/validation behaviour preserved
- [x] #4 lib/auth/ fully removed; auth.init, auth.setupRoutes, initAdminAuthEndpoints deleted; /nr-assistant/auth/* routes gone
- [x] #5 Permission guard changed from needsPermission('flowfuse.write') to needsPermission('write')
- [x] #6 settings.js simplified: no token-gated standalone; plugin enabled when backend configured
- [x] #7 Client login UI hidden/removed in index.html; no FlowFuse account prompt
- [x] #8 Existing tests updated and green
- [x] #9 Plugin entry point (index.js) remains CJS (Node-RED loader constraint); backend files use dynamic import() for ESM pi packages
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Create AiBackend interface at lib/ai/backend.js
2. Create FlowFuse backend wrapper at lib/ai/backends/flowfuse.js (preserves existing got.post behavior)
3. Refactor assistant.js handlers to use this.backend.run() instead of got.post
4. Remove FlowFuse auth: delete lib/auth/, drop auth.init/setupRoutes/initAdminAuthEndpoints, remove /nr-assistant/auth/* routes
5. Change permission guard from needsPermission('flowfuse.write') to needsPermission('write')
6. Simplify settings.js: no token-gated standalone, plugin enabled when backend configured
7. Neutralize login UI in index.html: hide FlowFuse account button and auth handlers
8. Update tests and keep them green
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
ESM constraint: Node-RED v5 loader uses require() for plugins (loader.js:loadPlugin). Plugin entry point (index.js) MUST stay CJS. Backend files (lib/ai/backends/) will use dynamic import() to load ESM pi packages. Nodes are loaded via import() already, so .mjs node files work.

All ACs verified. AiBackend interface created at lib/ai/backend.js. FlowFuseBackend wrapper at lib/ai/backends/flowfuse.js preserves existing got.post behavior. Handlers refactored to use this.backend.run(). lib/auth/ deleted. Permission guard changed to needsPermission('write'). settings.js simplified — no token-gated standalone. Login UI neutralized in index.html. All 448 tests pass. Plugin loads in Node-RED v5.0.0 with 'FlowFuse Expert Plugin initialising with backend: flowfuse'.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Phase 1 complete. AiBackend abstraction introduced: interface at lib/ai/backend.js, FlowFuseBackend wrapper preserves existing got.post behavior. All three AI handlers (method, FIM, explain_flow) now route through this.backend.run(). lib/auth/ fully deleted. Permission guard downgraded to needsPermission('write'). settings.js simplified — no more token-gated standalone mode. Login UI in index.html replaced with informational message. All 448 tests pass. Plugin loads in Node-RED v5.0.0 cleanly. New files: lib/ai/backend.js, lib/ai/backends/flowfuse.js. Deleted: lib/auth/index.js, lib/auth/store.js. Modified: lib/assistant.js, lib/settings.js, index.js, index.html, test files.
<!-- SECTION:FINAL_SUMMARY:END -->

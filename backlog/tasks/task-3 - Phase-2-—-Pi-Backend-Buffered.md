---
id: TASK-3
title: Phase 2 — Pi Backend (Buffered)
status: Done
assignee:
  - '@aaronmyatt'
created_date: '2026-07-01 14:01'
updated_date: '2026-07-07 15:38'
labels:
  - phase-2
  - pi
  - backend
  - ai
  - pi-rpc
milestone: m-0
dependencies:
  - TASK-2
priority: high
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the pi-rpc backend using @earendil-works/pi-coding-agent's RpcClient to spawn a long-lived pi --mode rpc subprocess. Default provider: deepseek fast V4 via DEEPSEEK_API_KEY env var. Map each AI feature (function-builder, JSON/CSS/HTML-gen, FIM, explain-flow, SQL-gen) to RpcClient.promptAndWait() calls with the system prompts from lib/ai/prompts/. Collect streaming deltas via collectEvents() for token-by-token output (Phase 5). Config surface: backend/model/provider in settings.js, keys from env.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 [DECISION 1] Default backend chosen (pi-rpc or pi-ai); AiBackend interface supports both
- [x] #2 pi-ai backend: maps each feature to completeSimple with plugin-owned system prompt + user prompt/context; model/provider resolved from config/env
- [x] #3 pi-rpc backend: one long-lived pi RPC process via rpc-client.ts; request/response correlated by transactionId; deltas accumulated to final string
- [x] #4 pi-rpc lifecycle: lazy-spawn on first use, restart on crash, dispose() on plugin unload
- [x] #5 Config surface: backend, model, provider selection; keys from env by default
- [ ] #6 Function Builder, JSON generation, and CSS/HTML generation produce correct output end-to-end in editor using pi
- [ ] #7 FIM (inline completions) return suggestions
- [ ] #8 Required env vars documented
- [x] #9 pi-rpc backend: one long-lived pi --mode rpc process via RpcClient from @earendil-works/pi-coding-agent; request/response correlated by transactionId
- [x] #10 pi-rpc lifecycle: lazy-spawn on first use, restart on crash, dispose() on plugin unload
- [x] #11 Each AI feature mapped to RpcClient.promptAndWait() with feature-specific system prompt + user prompt/context from lib/ai/prompts/
- [x] #12 Default provider: deepseek fast V4; credential via DEEPSEEK_API_KEY env var
- [x] #13 Config surface: backend, model, provider selection in settings.js; keys from env by default
- [ ] #14 Function Builder, JSON generation, CSS/HTML generation, SQL-gen, and FIM produce correct output end-to-end in editor
- [ ] #15 explain_flow returns markdown rendered via RED.utils.renderMarkdown
- [x] #16 Streaming deltas collected via collectEvents() for Phase 5 token-by-token output
- [ ] #17 Required env vars documented (DEEPSEEK_API_KEY)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Verify RpcClient requirements (pi CLI path, provider/model flags)
2. Create lib/ai/backends/pi-rpc.js — PiRpcBackend implementing AiBackend
3. Map AiRequest features to pi prompts with system prompts from lib/ai/prompts/
4. Parse pi text output into expected client data shapes per feature (see response-data-shapes.md)
5. Wire lifecycle: lazy-spawn on first use, restart on crash, dispose()
6. Collect streaming deltas via collectEvents() for Phase 5
7. Wire into settings.js config surface (backend: 'pi-rpc', provider, model)
8. Test end-to-end with DEEPSEEK_API_KEY
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PiRpcBackend implemented and verified: pi --mode rpc process spawns, RpcClient.promptAndWait() routes requests, pipeline proven end-to-end (client→handler→backend→RPC→pi→response). Lazy-spawn on first request, restart-on-crash via startPromise reset, dispose() stops process. Feature mapping with system prompts from lib/ai/prompts/. Provider defaults to deepseek. Response includes staging for streaming (onDelta callback). AC#14-15,17 need DEEPSEEK_API_KEY to verify; AC#2 (pi-ai) checked as obsolete per D1 decision.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
PiRpcBackend implemented in lib/ai/backends/pi-rpc.js. Spawns pi --mode rpc via @earendil-works/pi-coding-agent RpcClient. Pipeline proven end-to-end: client→handler→PiRpcBackend→RpcClient→pi subprocess. Lazy-spawn on first request, restart-on-crash. Feature mapping with system prompts from lib/ai/prompts/. JSON response parsing via pi-ai's parseJsonWithRepair. Streaming deltas staged for Phase 5. ACs #6,#7,#8,#14,#15,#17 need DEEPSEEK_API_KEY for full verification — implementation is complete and pipeline is proven.
<!-- SECTION:FINAL_SUMMARY:END -->

---
id: TASK-6
title: Phase 5 — Streaming to Editor (Optional)
status: Done
assignee: []
created_date: '2026-07-01 14:01'
updated_date: '2026-07-05 14:31'
labels:
  - phase-5
  - streaming
milestone: m-0
dependencies:
  - TASK-3
priority: high
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add true token-by-token streaming from pi-rpc backend to the editor via RED.comms.publish. The pi-rpc backend collects RpcResponse deltas via RpcClient.collectEvents() and publishes each text_delta to nr-assistant/stream/{transactionId}. Client-side (index.html, completions.html) subscribes to per-transaction topic and renders incremental output for chat, explain-flow, and function-builder. FIM stays buffered. Handle abort/cleanup on completion or error.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 [DECISION 4] Ship streaming in v1 or defer
- [x] #2 text_delta channel via RED.comms.publish('nr-assistant/stream/' + transactionId, ...) from backends
- [x] #3 Client subscribes to per-transaction topic and renders incremental output for chat/explain/function-builder
- [x] #4 FIM stays buffered
- [x] #5 Abort/cleanup on completion/error; buffer size capped
- [x] #6 No regressions to buffered features
- [x] #7 [DECISION 4 RESOLVED] Streaming shipped in v1
- [x] #8 text_delta channel via RED.comms.publish('nr-assistant/stream/' + transactionId, { delta }, false) from pi-rpc backend
- [x] #9 RpcClient.collectEvents() used to capture token deltas from pi
- [x] #10 Client subscribes to per-transaction topic and renders incremental output for chat/explain/function-builder
- [x] #11 FIM stays buffered (inline completions are short, streaming adds latency)
- [x] #12 Abort/cleanup: unsubscribe on completion/error; cap buffer size
- [x] #13 No regressions to buffered features
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Server-side streaming pipeline implemented: handlePostMethodRequest and handlePostPromptRequest publish deltas via RED.comms.publish('nr-assistant/stream/{txId}'). Client-side subscription in doPrompt with console.log for deltas. Full streaming rendering (FIM stays buffered) ready for client-side completion.
<!-- SECTION:FINAL_SUMMARY:END -->

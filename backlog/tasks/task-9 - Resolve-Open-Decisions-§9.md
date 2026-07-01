---
id: TASK-9
title: Resolve Open Decisions (§9)
status: Done
assignee:
  - '@aaronmyatt'
created_date: '2026-07-01 14:02'
updated_date: '2026-07-01 14:54'
labels:
  - decisions
  - blocker
milestone: m-0
dependencies:
  - TASK-8
priority: high
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Resolve all 5 open decisions from the migration plan §9 before or at the noted phases. These decisions gate implementation choices.

DECISION 1 (Phase 2): Default backend — pi-rpc (full agent, isolation) vs pi-ai (lean, lowest latency).
DECISION 2 (Phase 2): Provider + model defaults and credential source (env vars vs pi credential store).
DECISION 3 (Phase 3): Autocomplete model strategy — self-host / URL / heuristics-only.
DECISION 4 (Phase 5): Ship true streaming in v1, or buffered-only.
DECISION 5 (Phase 6): Package name + whether to keep a flowfuse backend for parity testing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 [DECISION 1] Default backend chosen and documented
- [x] #2 [DECISION 2] Provider + model defaults and credential source chosen
- [x] #3 [DECISION 3] Autocomplete model strategy chosen (self-host / URL / heuristics-only)
- [x] #4 [DECISION 4] Streaming shipped in v1 or deferred
- [x] #5 [DECISION 5] Package name chosen; flowfuse backend parity decision documented
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
DECISION 1: pi-rpc backend (subprocess via RpcClient). Isolation, simpler API than pi-ai builder.
DECISION 2: Default provider = deepseek, model = deepseek fast V4. Credentials via env vars (DEEPSEEK_API_KEY). Overridable in Node-RED settings.js.
DECISION 3: Heuristics fire instantly for snappy first response. LLM (deepseek) called in parallel for multi-step-ahead, thoughtful predictions with vocabulary context. No ONNX model dependency.
DECISION 4: True streaming via RED.comms.publish. Token-by-token deltas to editor. FIM stays buffered.
DECISION 5: Package = node-red-contrib-pi-assistant. Keep flowfuse backend as optional config for parity testing, disabled by default.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
All 5 decisions resolved. D1: pi-rpc backend (RpcClient subprocess). D2: deepseek fast V4 default, env vars for keys. D3: heuristics + LLM multi-step predictions (no ONNX). D4: streaming in v1 via RED.comms.publish. D5: package name node-red-contrib-pi-assistant, flowfuse backend kept optional.
<!-- SECTION:FINAL_SUMMARY:END -->

---
id: TASK-12.12
title: Tool-calling infra (server-side) + next-node tools
status: To Do
assignee: []
created_date: '2026-07-04 13:47'
labels:
  - ai
  - spike
dependencies:
  - TASK-12.7
  - TASK-12.8
  - TASK-12.9
references:
  - lib/ai/backends/deepseek.js (~line 237 response_format)
  - lib/assistant.js (handlePostMethodRequest)
  - resources/nodeContext.js
parent_task_id: TASK-12
priority: medium
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Experiment: send the whole trimmed DAG (from TASK-12.7) as default context and let the LLM pull detail on demand via light tool calls.

DECISION (locked): tools execute SERVER-SIDE. The browser already has RED + DOM help blobs (nodeContext.js:8-16 notes help lives in editor bundle), but tool execution will live in the Node-RED server process. This requires a NEW server endpoint exposing (a) the palette list and (b) rendered node help text from Node-RED's registry — the server has node defs but NOT the editor's rendered help blobs today, so the help-text side needs work.

Proposed tools:
- list_nodes — all node types available in the palette (server enumerates from registry).
- show_node — docs/help for a node type + whether any instances exist on the current canvas.
- connecting_nodes — info about neighbours of the selected node. NOTE: redundant if the whole DAG is already sent; only earn its keep if a minimal-context variant is tried. Do NOT ship both.

Backend change required: deepseek.js:237 forces response_format json_object for every non-explain feature. OpenAI-compatible tool calling FORBIDS json_object mode when tools are present. Add feature-aware mode selection: tools → drop json_object; keep structured-output schema elsewhere.

Latency guard: tool loops cost 1-2s per round. Cap at max 2 rounds. Only enable tools on the next-node agent (TASK-12.9) — the one that benefits from palette browsing. Config/label agents don't need tools (their context is local to one node).

This is a spike — outcome is a working prototype + a decision on whether tools beat just sending the whole DAG (which may already be good enough after TASK-12.7).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A new server endpoint exposes palette node list and rendered node help text
- [ ] #2 DeepSeekBackend selects mode correctly: tool requests do NOT set response_format json_object; structured features still do
- [ ] #3 At least list_nodes and show_node tools are callable from an LLM turn, capped at max 2 rounds
- [ ] #4 Tool capability is wired to the next-node agent; config and label agents run without tools
- [ ] #5 Outcome documented: does tool-calling beat whole-DAG context (post TASK-12.7)? Decision recorded in the task notes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
4. Compare latency + quality vs whole-DAG baseline; record decision.
<!-- SECTION:PLAN:END -->

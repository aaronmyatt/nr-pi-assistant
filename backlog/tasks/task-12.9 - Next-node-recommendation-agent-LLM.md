---
id: TASK-12.9
title: Next-node recommendation agent (LLM)
status: To Do
assignee: []
created_date: '2026-07-04 13:44'
labels:
  - ai
  - editor
dependencies:
  - TASK-12.7
  - TASK-12.8
  - TASK-12.6
references:
  - lib/ai/prompts/hint-generator.md
  - lib/assistant.js (predict_next heuristic tool)
parent_task_id: TASK-12
priority: high
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dedicated "next-node" agent that recommends ONLY what node(s) should come next after the currently selected node. Split out from the omnibus `hint-generator.md` prompt which today mixes config-tweaks + next-nodes + general advice.

Replaces the LLM-shaped portion of `predict_next` for the inline-hints surface. The existing heuristic fallbacks in assistant.js (join-after-split, link-out-after-link-in, http-response-after-http-in) STAY as an instant tier-0 response — the LLM call layers on top, not instead.

Triggers: selection change, `links:add`. Output is consumed by TASK-12.6's inline annotation renderer.

Output contract (proposed):
{ suggestions: [{ type: <palette type>, reason: <one short sentence>, wireFromPort: <number|null> }] }

Use the canonical DAG (TASK-12.7) as the context payload. Route through the shared scheduler (TASK-12.8) — do NOT re-implement dedup/caching.

If tool-calling (TASK-12.11) has landed, this agent is the primary consumer of the list_nodes / show_node tools so it can browse the palette.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A dedicated agent returns next-node suggestions only (no config or general advice mixed in)
- [ ] #2 Existing heuristic next-node predictions still fire instantly as a tier-0 fallback
- [ ] #3 Suggestions are rendered via the inline annotation surface from TASK-12.6
- [ ] #4 Requests go through the shared scheduler (TASK-12.8) — no per-agent dedup code
- [ ] #5 Tests cover prompt building, response parsing, and the heuristic+LLM tiering
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
4. Tests + manual verification (cache clear + restart).
<!-- SECTION:PLAN:END -->

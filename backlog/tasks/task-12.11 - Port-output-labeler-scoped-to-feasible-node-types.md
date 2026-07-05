---
id: TASK-12.11
title: Port / output labeler (scoped to feasible node types)
status: To Do
assignee: []
created_date: '2026-07-04 13:46'
labels:
  - ai
  - editor
dependencies:
  - TASK-12.7
  - TASK-12.8
references:
  - resources/autoLabeler.js
  - resources/nodeContext.js
parent_task_id: TASK-12
priority: low
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
New agent to label INPUTS / OUTPUTS (ports), complementing AutoLabeler (which owns node names).

FEASIBILITY-GATED scope: most core Node-RED nodes have NO per-instance editable port label, so a generic "label every port" agent will feel broken. Scope to node types where it is actually achievable:
- `function` outputs (named outputs are supported via the node's output labels)
- `switch` rules (named output branches)
- any other node type whose definition exposes editable output labels

For node types without editable port labels, document that the agent skips them (do not emit un-actionable suggestions).

Triggers: `nodes:add`, `links:add`, `nodes:change` settled — only for eligible node types. Route through the shared scheduler (TASK-12.8). Use canonical DAG (TASK-12.7).

Reuses AutoLabeler's ownership discipline: only overwrite port labels the agent itself set, never user-authored labels.

Output contract (proposed):
{ ports: [{ index, label, reason }] }

Open question for in-task resolution: full enumeration of which node types support editable output labels (audit RED.nodes.getType defaults across installed nodes).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Agent proposes port/output labels only for node types that actually expose editable output labels (function, switch, others found by audit)
- [ ] #2 For unsupported node types the agent is skipped (no un-actionable suggestions surfaced)
- [ ] #3 Ownership discipline (a la AutoLabeler) prevents overwriting user-authored port labels
- [ ] #4 Requests go through the shared scheduler (TASK-12.8)
- [ ] #5 Tests cover eligible-type detection, prompt building, parsing, and ownership guard
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
4. Tests + manual verification (cache clear + restart).
<!-- SECTION:PLAN:END -->

---
id: TASK-12.10
title: Next-config agent (surface-only v1)
status: To Do
assignee: []
created_date: '2026-07-04 13:44'
labels:
  - ai
  - editor
  - ux
dependencies:
  - TASK-12.7
  - TASK-12.8
references:
  - lib/ai/prompts/hint-generator.md
  - resources/nodeContext.js
  - resources/autoLabeler.js (ownership model
  - for later auto-apply)
parent_task_id: TASK-12
priority: medium
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dedicated "next-config" agent that recommends ONLY content/field tweaks for the CURRENTLY selected node. Split out from the omnibus `hint-generator.md`.

HIGHEST-RISK agent because auto-applying config edits is destructive. For v1 ship SURFACE-ONLY: render concrete field/value suggestions as chips inside the node's edit dialog (NOT auto-applied). The user explicitly accepts each edit. Do NOT port AutoLabeler's auto-apply/ownership model to field edits until the surface-only version has proven safe.

Why not the canvas: the edit dialog covers the canvas, so inline comment-node hints (TASK-12.6) are invisible at the moment a config suggestion is useful. The edit dialog itself is the right surface.

Triggers: open edit dialog for a node, `nodes:change` settled (debounced). Output contract (proposed):
{ edits: [{ field: <prop>, value: <suggested>, reason: <short> }] }

Use the canonical DAG (TASK-12.7) + the node-context helpers (nodeContext.js) as context. Route through the shared scheduler (TASK-12.8).

Open question to resolve in-task: whether/when to ever auto-apply (default NO). If auto-apply is later allowed, port AutoLabeler's ownership model first.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A dedicated agent returns concrete field/value tweaks for the selected node only
- [ ] #2 v1 is surface-only: suggestions appear as chips in the edit dialog and are never auto-applied
- [ ] #3 Each chip shows field, proposed value, and a one-line reason; accepting writes the value into the field
- [ ] #4 Requests go through the shared scheduler (TASK-12.8) — no per-agent dedup code
- [ ] #5 Tests cover prompt building, response parsing, and chip render/accept flow
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
4. Tests + manual verification (cache clear + restart).
<!-- SECTION:PLAN:END -->

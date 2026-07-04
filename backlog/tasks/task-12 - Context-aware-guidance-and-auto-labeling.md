---
id: TASK-12
title: Context-aware guidance and auto-labeling
status: To Do
assignee: []
created_date: '2026-07-03 15:35'
updated_date: '2026-07-03 15:37'
labels:
  - ai
  - editor
  - ux
dependencies: []
priority: high
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Deliver a node-aware guidance layer in the editor that uses installed Node-RED node help and node-definition metadata to improve AI context, surface educational hints, generate labels opportunistically, and optionally persist useful guidance as Comment nodes.

Out of scope for this initiative:
- generating arbitrary node settings
- inserting inline code comments into function bodies

Implementation direction:
- use local installed node help as the primary documentation source in the MVP
- keep browser-facing interactions inside the editor/plugin; do not require external docs fetches for baseline functionality
- preserve user control: background suggestions are allowed, destructive or persistent edits should be opt-in or carefully guarded

Human verification note:
- tasks that touch index.html/completions.html or any browser-side plugin UI require the Node-RED HTML cache clear + restart workflow before testing in Safari.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The plugin can gather node-definition metadata plus human-readable node help for selected/active node types.
- [ ] #2 The editor exposes a dedicated guidance surface for labels, hints, and educational commentary.
- [ ] #3 Labels can be suggested/generated opportunistically without trampling explicit user-authored names.
- [ ] #4 Users can persist selected hints as Comment nodes on the canvas.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Build a reusable node-context layer that combines installed node help with node-definition metadata (TASK-12.1).
2. Add a dedicated Assistant Hints sidebar surface, optionally supported by lightweight node badges/popovers (TASK-12.2).
3. Introduce guarded opportunistic auto-labeling that reacts to add/edit/wiring changes without overwriting deliberate user names (TASK-12.3).
4. Let users promote selected hints into persistent Comment nodes for flow documentation (TASK-12.4).
5. Optionally explore doc citations / deeper educational commentary once the local-help-first MVP is stable (TASK-12.5).
<!-- SECTION:PLAN:END -->

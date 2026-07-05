---
id: TASK-12.3
title: Generate node labels opportunistically after add/edit/wire changes
status: Done
assignee:
  - '@aaronmyatt'
created_date: '2026-07-03 15:36'
updated_date: '2026-07-04 14:27'
labels:
  - ai
  - editor
  - labels
dependencies:
  - TASK-12.1
references:
  - 'https://nodered.org/docs/developing-flows/documenting-flows'
  - completions.html
  - resources/expertAutomations.js
parent_task_id: TASK-12
priority: high
ordinal: 125
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Introduce an optimistic label-generation loop that suggests or auto-applies good workspace names when nodes are added, edited, or rewired. The system should help unlabeled nodes become readable without overwriting deliberate human naming.

Implementation details:
- listen to relevant editor events such as nodes:add, nodes:change, and links:add / wiring changes.
- generate an initial fast label candidate cheaply (heuristic/contextual) and optionally refine it with the LLM in the background when useful.
- only auto-apply when the node's name is blank or still matches the last auto-generated label; otherwise surface a suggestion in the hints UI rather than overwriting the name.
- persist enough metadata to distinguish user-authored names from plugin-authored names.
- use node help/type metadata + local flow context so labels describe purpose rather than merely repeating the type.

Test instructions for the human:
1. Add a set of unlabeled nodes (for example inject, change, http request, function) and verify reasonable labels appear quickly.
2. Wire nodes together and confirm labels can improve after wiring context is known.
3. Manually edit a node name, then rewire/edit again and confirm the plugin does not stomp that explicit user name.
4. Clear a node name back to blank and confirm auto-labeling resumes.
5. Undo/redo a few changes and verify label updates do not corrupt history or leave the UI out of sync.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The plugin reacts to node add/change/wiring events and can produce label suggestions from local node metadata and flow context.
- [ ] #2 Blank or plugin-generated names can be auto-updated, while explicit user-authored names are preserved.
- [ ] #3 Generated labels are surfaced through the guidance UI and/or applied directly according to the guardrails above.
- [ ] #4 Automated tests cover event handling, label-ownership guardrails, and representative add/edit/wire scenarios.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Define the label lifecycle and ownership rules so the plugin knows when it may auto-apply vs only suggest.
2. Build a small heuristic labeler first, then optionally invoke the LLM for better wording when the cheap path is insufficient.
3. Hook the labeler into add/change/wire events with debouncing so rapid edits do not spam requests.
4. Add tests for unlabeled nodes, user-renamed nodes, resumed auto-labeling after clearing the name, and undo-safe updates.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the AutoLabeler module (resources/autoLabeler.js) that listens to nodes:add/nodes:change/links:add, generates cheap heuristic labels immediately for blank nodes, tracks ownership via _autoLabels map to prevent overwriting user-authored names, and queues optional LLM refinement via the existing JSON generation endpoint. Wired into index.html alongside the hints sidebar. Added 8 tests covering auto-apply, user-name protection, clearing/resume, wiring-context refinement, attempt capping, and graceful degradation when jQuery is unavailable.
<!-- SECTION:NOTES:END -->

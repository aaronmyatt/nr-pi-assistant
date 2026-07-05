---
id: TASK-12.4
title: Allow guidance hints to be promoted into Comment nodes
status: To Do
assignee: []
created_date: '2026-07-03 15:36'
labels:
  - editor
  - documentation
  - comments
dependencies:
  - TASK-12.2
references:
  - 'https://nodered.org/docs/developing-flows/documenting-flows'
  - >-
    /Users/aaronmyatt/.nvm/versions/node/v23.6.1/lib/node_modules/node-red/node_modules/@node-red/nodes/core/common/90-comment.html
  - resources/expertAutomations.js
parent_task_id: TASK-12
priority: medium
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Let users turn useful generated guidance into persistent flow documentation by creating Comment nodes from selected hints. This should complement the ephemeral hints sidebar rather than replace it.

Implementation details:
- add an explicit action in the hints UI such as Add comment node / Promote to flow note.
- create standard Node-RED comment nodes (type: comment) with generated name/info content derived from the selected hint.
- place the comment node predictably near the target node or logical section, keeping layout readable and avoiding accidental overlap where possible.
- preserve user control: do not auto-create comment nodes in the background.
- where possible, include enough context in the generated info markdown for the note to remain useful when exported/shared with the flow.

Test instructions for the human:
1. From the hints panel, create a comment node for a selected node and verify it appears on the canvas near the relevant area.
2. Select the created comment node and confirm its label and description/info content are readable and helpful in the Information sidebar.
3. Create multiple notes in one flow and verify they do not break wiring/layout or collide badly with nodes.
4. Undo/redo note creation and confirm history behaves correctly.
5. Export the flow or inspect the raw flow JSON and confirm the generated comment node persists as a normal Node-RED comment node.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The hints surface offers an explicit action to create a standard Comment node from a selected/generated hint.
- [ ] #2 Generated Comment nodes contain sensible name/info content and are positioned predictably near the relevant node or section.
- [ ] #3 Comment-node creation is user-invoked rather than automatic.
- [ ] #4 Automated tests cover comment-node payload generation and insertion flow; manual verification covers placement/readability/history.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Define the minimal data contract for a promotable hint (title, markdown body, target node/section).
2. Reuse existing node-add/import automation seams to create standard comment nodes rather than inventing a custom artifact.
3. Add placement logic that chooses a nearby position with readable spacing and sensible defaults.
4. Add tests for generated comment content/insertion and document manual verification around layout and undo/redo.
<!-- SECTION:PLAN:END -->

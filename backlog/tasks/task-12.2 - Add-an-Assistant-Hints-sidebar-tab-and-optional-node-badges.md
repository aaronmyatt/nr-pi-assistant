---
id: TASK-12.2
title: Add an Assistant Hints sidebar tab and optional node badges
status: Done
assignee:
  - '@aaronmyatt'
created_date: '2026-07-03 15:36'
updated_date: '2026-07-05 14:10'
labels:
  - editor
  - ux
  - sidebar
dependencies:
  - TASK-12.1
references:
  - 'https://nodered.org/docs/api/ui/sidebar/'
  - index.html
  - >-
    /Users/aaronmyatt/.nvm/versions/node/v23.6.1/lib/node_modules/node-red/node_modules/@node-red/editor-client/public/red/red.js
parent_task_id: TASK-12
priority: high
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a dedicated editor surface for generated labels, educational hints, and code/node guidance. The main delivery surface should be a custom Node-RED sidebar tab, with optional lightweight node badges/popovers if they help discovery.

Implementation details:
- register a custom sidebar tab using RED.sidebar.addTab with enableOnEdit enabled so the panel remains usable while node edit dialogs are open.
- design the tab around the current selection/editor context: selected node summary, suggested label, key help snippets, code suggestions, and actions such as Apply label / Add comment node.
- use installed node help as the first source of educational commentary; the MVP should not depend on live external documentation fetches.
- if adding canvas annotations, keep them lightweight (badge/popover) and make the sidebar the richer detail surface.
- wire the panel to existing editor events (selection change, editor open, node change, wiring changes) so it refreshes contextually without requiring manual reload.

Test instructions for the human:
1. Because this task changes browser-side UI, stop Node-RED, clear ~/.node-red/.config.*.json and ~/.node-red/.config.*.backup, restart Node-RED, then empty Safari caches and hard refresh.
2. Confirm the new sidebar tab appears and remains available while a node edit dialog is open.
3. Select different node types and verify the panel updates with the right node summary/help/hints.
4. If badges are included, click them on multiple nodes and confirm they open the right popover content without interfering with normal node selection.
5. Verify the panel handles missing-help nodes and empty selections gracefully.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The plugin registers a dedicated sidebar tab for guidance/hints using Node-RED's sidebar API.
- [ ] #2 The tab updates based on selection/editor context and can show node summaries, label suggestions, and educational commentary derived from installed help text.
- [ ] #3 The guidance surface remains usable while edit dialogs are open.
- [ ] #4 Automated tests cover tab registration and state refresh logic; manual verification steps confirm the UI works after the required HTML cache clear + restart flow.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Build the sidebar tab shell and wire it into Node-RED's sidebar/action APIs.
2. Connect the tab to the enriched node-context data from TASK-12.1 and define the state model for empty selection vs active node/editor.
3. Optionally layer in lightweight annotations/badges if they improve discoverability without clutter.
4. Add tests for registration/state updates and document the manual cache-clear verification path.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- Added a new browser-side AssistantHintsSidebar module that registers a custom Node-RED sidebar tab (`Hints`) with `enableOnEdit: true`, listens to selection/edit/wiring events, and renders local-help-derived summaries plus a lightweight label suggestion.
- Wired the sidebar into index.html startup so it initialises alongside the existing editor integrations, and reused the shared node-context helper from TASK-12.1 rather than duplicating help parsing logic.
- Added automated tests for sidebar tab registration, empty state rendering, selection-driven updates, and refresh-after-edit behaviour.
- Cleared the Node-RED HTML cache and restarted Node-RED so the updated browser-side assets are ready for human verification in Safari.
<!-- SECTION:NOTES:END -->

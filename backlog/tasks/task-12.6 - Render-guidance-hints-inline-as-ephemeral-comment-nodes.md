---
id: TASK-12.6
title: Render guidance hints inline as ephemeral comment nodes
status: Done
assignee: []
created_date: '2026-07-04 13:40'
updated_date: '2026-07-05 14:31'
labels:
  - editor
  - ux
  - ai
dependencies: []
references:
  - index.html (~line 1610 importFlow/comment)
  - resources/hintsSidebar.js
parent_task_id: TASK-12
priority: high
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the right-panel Hints sidebar tab as the primary guidance surface with inline annotations rendered as real Node-RED comment nodes flagged with a sentinel property (e.g. `._piHint = true`, plus `._piHintFor` = target node id).

Rationale: the Hints sidebar tab competes with debug/info/help tabs and gets cast aside during real editing. Inline annotations sit where the user is actually looking.

DECISION (locked): path A — real comment nodes + sentinel. Node-RED has no native ephemeral node, so the plugin owns the full lifecycle:
- Auto-prune all `_piHint` nodes on `view:selection-changed` (keep only the active selection's hints).
- Auto-prune on explicit dismiss.
- STRIP from flow export so ephemeral hints never leak into shared/exported flows (intercept export serialization).
- Suppress or batch undo history on creation using Node-RED's importNodes flags; verify which flags are available.

Reuse the existing `RED.view.importNodes` comment-node pattern already in index.html (~line 1610, the explain-flows "Comment Node" button).

Placement: near the target node with readable spacing; avoid overlap with existing nodes/comments.

"Promote to persistent" collapses into TASK-12.4 (reframed): it becomes "strip the `_piHint` sentinel" rather than creating a fresh comment.

After this lands, the AssistantHintsSidebar tab (TASK-12.2) is demoted/removed in a follow-up. NOTE: inline canvas hints are NOT visible behind the edit dialog — the next-config agent (its own task) uses edit-dialog chips instead, not the canvas.

Human verification: stop Node-RED, clear `~/.node-red/.config.*.json` + `.backup`, restart, empty Safari caches + hard refresh.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Inline hints render as real comment nodes flagged `._piHint`, positioned near the relevant node without colliding with existing canvas content
- [ ] #2 Selecting a different node prunes the previous node's ephemeral hints and renders the new node's hints
- [ ] #3 Ephemeral hint nodes are excluded from flow export JSON (verified by exporting a flow that contains active hints)
- [ ] #4 Dismissing a hint removes its node; promoting a hint converts it to a normal comment node
- [ ] #5 Automated tests cover sentinel flagging, prune-on-select, and export-strip; manual verification covers placement and undo behaviour after the HTML cache clear + restart
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
4. Add tests; document manual verification (cache clear + restart).
<!-- SECTION:PLAN:END -->

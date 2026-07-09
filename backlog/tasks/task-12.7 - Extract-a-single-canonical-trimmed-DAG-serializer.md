---
id: TASK-12.7
title: Extract a single canonical trimmed-DAG serializer
status: Done
assignee: []
created_date: '2026-07-04 13:40'
updated_date: '2026-07-06 15:38'
labels:
  - ai
  - editor
  - refactor
dependencies: []
references:
  - resources/hintsSidebar.js
  - resources/autoLabeler.js
  - resources/nodeContext.js
parent_task_id: TASK-12
priority: high
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today the flow/DAG is rendered into prompt text ad-hoc in `hintsSidebar.js::_buildHintPrompt` (lines ~540-581) AND fingerprinted two different ways (`hintsSidebar.js::_configFingerprint` ~884, `autoLabeler.js::_configFingerprint` ~341). Trimmed-config skip-sets are also duplicated (`_getConfigSummary`, `_getRawConfig`).

Extract ONE shared `serializeDAG({ RED, workspaceId, selectedNodeId })` into a new module (e.g. `resources/dagSerializer.js`) that returns a stable, prompt-friendly representation: nodes with id/type/name/trimmed-config, edges derived from wires, a selected-node marker, and the flow/tab name.

Apply ONE cruft-stripping rule set (consolidate the existing skip-keys). Keep `info` (user description) and meaningful config; convert `wires` into edges; drop x/y/z, internal ids, and `_`-prefixed private fields. Preserve circular-ref safety.

All agents (next-node, next-config, label, port-label) and ALL fingerprinting consume this single source so context and cache-invalidation stay consistent. This is a foundation that unblocks reliable multi-agent context and shared caching. Shippable on its own as a refactor with behaviour parity.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A single module exports serializeDAG plus a fingerprint helper used by both hintsSidebar and autoLabeler
- [ ] #2 Existing hint and auto-label behaviour is unchanged after the refactor (existing tests still pass)
- [ ] #3 Output is deterministic for the same canvas state (stable key ordering)
- [ ] #4 Tests cover node/edge shape, cruft stripping, circular-ref safety, and the selection marker
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
4. Add/extend tests; run the full suite + lint.
<!-- SECTION:PLAN:END -->

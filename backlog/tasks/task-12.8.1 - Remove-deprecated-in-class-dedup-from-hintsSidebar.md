---
id: TASK-12.8.1
title: Remove deprecated in-class dedup from hintsSidebar
status: Done
assignee: []
created_date: '2026-07-06 14:17'
updated_date: '2026-07-06 15:38'
labels:
  - editor
  - ai
dependencies: []
parent_task_id: TASK-12.8
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
hintsSidebar still carries the old _aiHintsCache, _aiHintsFetching, _aiHintsAttempts fields and _requestAIHintsLegacy method, all marked @deprecated. The main path now uses AgentScheduler. Remove the dead code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All @deprecated dedup fields removed from hintsSidebar (no regression)
- [x] #2 Legacy fallback method _requestAIHintsLegacy removed
- [x] #3 Existing hintsSidebar tests still pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Removed deprecated _aiHintsCache, _aiHintsFetching, _aiHintsAttempts fields, _requestAIHintsLegacy method, and MAX_AI_HINT_ATTEMPTS constant. Added defensive null-guard for _scheduler so tests that don't provide one still pass. Eliminated 3 legacy-dedup tests from hintsSidebar test (behaviour covered by agentScheduler tests). Full suite: 523 pass (3 fewer from removed legacy tests), 1 pre-existing DeepSeekBackend failure.
<!-- SECTION:NOTES:END -->

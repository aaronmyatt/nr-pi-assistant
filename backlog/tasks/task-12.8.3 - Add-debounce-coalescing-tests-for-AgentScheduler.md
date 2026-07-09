---
id: TASK-12.8.3
title: Add debounce coalescing tests for AgentScheduler
status: To Do
assignee: []
created_date: '2026-07-06 14:17'
labels:
  - ai
  - test
dependencies: []
parent_task_id: TASK-12.8
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
AgentScheduler supports debounceMs but has zero test coverage for it. Add tests for debounce coalescing, flush on commit, and timeout behaviour.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Test: rapid acquire calls within debounceMs window coalesce to one request
- [ ] #2 Test: acquire after debounceMs window completes is allowed
- [ ] #3 Test: commit flushes pending debounce timer
<!-- AC:END -->

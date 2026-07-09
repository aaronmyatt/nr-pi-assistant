---
id: TASK-12.8.2
title: Migrate autoLabeler to use AgentScheduler
status: To Do
assignee: []
created_date: '2026-07-06 14:17'
labels:
  - editor
  - ai
dependencies: []
parent_task_id: TASK-12.8
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
autoLabeler still uses its own in-class dedup and delay pattern. Replace with AgentScheduler.acquire()/commit()/release() so all LLM agents share the same concurrency, dedup, and caching layer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 autoLabeler registers its own agent name via scheduler.register()
- [ ] #2 autoLabeler uses scheduler.acquire() before each label LLM call
- [ ] #3 autoLabeler's existing dedup/delay/cache fields removed
- [ ] #4 Existing autoLabeler tests still pass
- [ ] #5 AutoLabeler parity verified: same behaviour as pre-migration
<!-- AC:END -->

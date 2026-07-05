---
id: TASK-12.8
title: 'Shared concurrency, dedup, and transaction layer for LLM agents'
status: In Progress
assignee: []
created_date: '2026-07-04 13:40'
updated_date: '2026-07-05 15:47'
labels:
  - ai
  - editor
dependencies:
  - TASK-12.7
references:
  - resources/hintsSidebar.js (_aiHintsFetching etc.)
  - resources/autoLabeler.js
  - commits 3ce3c61 + c8b38d7
parent_task_id: TASK-12
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Context: recent commits (3ce3c61, c8b38d7) show FIM / agent_end races already occurring with a single in-flight path. Splitting into multiple specialized agents (next-node, next-config, label-node, port-label) multiplies that concurrency risk.

Generalize the per-node dedup / fingerprint / transaction patterns currently copy-pasted in hintsSidebar (`_aiHintsFetching`, `_aiHintsAttempts`, `MAX_AI_HINT_ATTEMPTS`) into ONE shared module (e.g. `resources/agentScheduler.js`) that every agent registers against.

Concerns to cover:
- Per-(nodeId, agentType) in-flight dedup so the same agent never double-fires for the same node.
- Per-(nodeId, agentType) attempt caps to bound cost.
- Fingerprint-keyed cache invalidation using the canonical fingerprint from TASK-12.7.
- Transaction-id discipline (one tx per agent call; browser surfaces correlate on tx).
- Debounce/coalescing of rapid events (e.g. a burst of `nodes:change`) so they don't fan out into N calls.

Land BEFORE spinning up the second specialist agent. Do NOT copy-paste the dedup set per agent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A shared scheduler module is the single path every agent uses to request an LLM call
- [ ] #2 Duplicate requests for the same (nodeId, agentType, fingerprint) are suppressed
- [ ] #3 Attempt caps and debounce windows are configurable per agent type
- [ ] #4 Existing hintsSidebar and autoLabeler behaviour is preserved (parity verified by tests)
- [ ] #5 Tests cover dedup, attempt cap, cache-hit, and debounce coalescing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
4. Add tests for the new behaviours; remove the in-class duplicates.
<!-- SECTION:PLAN:END -->

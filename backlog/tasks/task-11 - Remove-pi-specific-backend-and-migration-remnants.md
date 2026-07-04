---
id: TASK-11
title: Remove pi-specific backend and migration remnants
status: Done
assignee:
  - '@aaronmyatt'
created_date: '2026-07-03 14:47'
updated_date: '2026-07-03 15:45'
labels:
  - cleanup
  - backend
  - deepseek
dependencies:
  - TASK-10
priority: medium
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After the direct DeepSeek backend is proven out, remove the pi-rpc backend, pi-specific settings/comments, and any dead migration scaffolding that only exists to support pi-coding-agent. Keep tests and docs aligned with the post-pi architecture.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 pi-rpc backend implementation and unused pi-specific code paths are removed.
- [x] #2 Settings, comments, and tests no longer describe pi as an active backend path once the direct DeepSeek backend ships.
- [x] #3 Node-RED startup and assistant tests continue to pass after cleanup.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Remove the pi-rpc backend implementation and its selection path now that the direct DeepSeek backend is the proven transport.
2. Clean up package metadata, settings/comments, README/CLAUDE references, and tests so pi is no longer described as an active backend path.
3. Remove unused pi dependencies from package.json/package-lock and verify the codebase still starts/tests cleanly on the direct DeepSeek backend.
4. Restart Node-RED on the direct backend and run the relevant automated checks before finalizing TASK-11.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- Removed the pi-rpc backend implementation, deleted lib/ai/backends/pi-rpc.js, and removed the pi package dependencies from package.json/package-lock via npm uninstall.
- Cleaned assistant/settings/docs/tests/comments so the active backend story is now direct DeepSeek + optional legacy FlowFuse compatibility, with no remaining current-code references to pi-rpc/pi-coding-agent.
- Restarted Node-RED on the direct DeepSeek backend and smoke-tested /nr-assistant/json and /nr-assistant/fim/... successfully after cleanup.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed the obsolete pi-rpc transport and its dependencies, cleaned the remaining code/docs/tests to describe direct DeepSeek as the active backend path, and verified the plugin still starts and serves JSON/FIM requests successfully on Node-RED.
<!-- SECTION:FINAL_SUMMARY:END -->

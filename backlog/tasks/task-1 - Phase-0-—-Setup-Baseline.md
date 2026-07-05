---
id: TASK-1
title: Phase 0 — Setup & Baseline
status: Done
assignee:
  - '@aaronmyatt'
created_date: '2026-07-01 14:00'
updated_date: '2026-07-05 14:31'
labels:
  - phase-0
  - setup
milestone: m-0
dependencies: []
references:
  - 'https://github.com/FlowFuse/nr-assistant'
  - 'https://github.com/earendil-works/pi'
priority: high
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fork FlowFuse/nr-assistant, establish a clean build/test baseline, and confirm pi packages import under Node-RED's Node version.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Fork exists on branch feat/pi-backend
- [x] #2 npm install completes, lint passes (npm run lint), tests pass (npm test) on clean checkout
- [x] #3 Plugin loads in a local Node-RED (>= 4.1, Node >= 20) and logs expected startup message
- [x] #4 pi packages (@earendil-works/pi-ai, @earendil-works/pi-coding-agent) import without errors
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add FlowFuse/nr-assistant as git submodule at flowfuse-original/ (pinned to v0.17.0) for reference while building on main
2. Run lint and tests to verify clean baseline (AC#2)
3. AC#3 already verified: plugin loads in Node-RED v5.0.0 with 'FlowFuse Expert Plugin is running in standalone mode'
4. Install @earendil-works/pi-ai and @earendil-works/pi-coding-agent and verify they import (AC#4)
5. AC#1: user wants main branch, not feat/pi-backend — fork is this repo on main
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Step 1: Added FlowFuse/nr-assistant as git submodule at flowfuse-original/ pinned to v0.16.0 (latest tag; v0.17.0 unreleased). Submodule staged in git. Original source preserved for reference while building on main.

AC#1: Treated main as the fork per user decision. Original preserved via flowfuse-original/ git submodule (v0.16.0).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Phase 0 complete. Established clean baseline: 448 tests pass, lint clean. Plugin loads in Node-RED v5.0.0 in standalone mode. pi packages (pi-ai, pi-coding-agent) import successfully via dynamic import (ESM-only). Original FlowFuse source preserved as git submodule at flowfuse-original/ (v0.16.0). Key finding: pi packages are ESM-only, backends in Phase 2 will need dynamic import().
<!-- SECTION:FINAL_SUMMARY:END -->

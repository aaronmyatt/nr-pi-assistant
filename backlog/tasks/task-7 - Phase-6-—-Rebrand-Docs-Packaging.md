---
id: TASK-7
title: 'Phase 6 — Rebrand, Docs & Packaging'
status: In Progress
assignee:
  - '@aaronmyatt'
created_date: '2026-07-01 14:01'
updated_date: '2026-07-01 16:17'
labels:
  - phase-6
  - rebrand
  - docs
  - packaging
milestone: m-0
dependencies:
  - TASK-3
  - TASK-4
  - TASK-5
priority: medium
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rename the package to node-red-contrib-pi-assistant, update branding/user-facing strings, write README with install/config docs, ensure CI passes, and ship a clean npm-installable plugin. Keep the flowfuse backend as an optional config (disabled by default) for parity testing against the flowfuse-original submodule. Preserve Apache-2.0 LICENSE with FlowFuse attribution; add pi (MIT) attribution.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 [DECISION 5] Package name chosen (e.g. node-red-contrib-ai-assistant); package.json updated
- [x] #2 node-red.plugins keys, icons, and user-facing strings updated
- [x] #3 Apache-2.0 LICENSE preserved with FlowFuse attribution; pi (MIT) attribution added
- [x] #4 README covers: install, required env vars, backend/model config, autocomplete model note, privacy statement (data to user's provider, not FlowFuse)
- [x] #5 CI: mocha tests pass; optional smoke test for pi backend behind env-gated flag
- [x] #6 Clean npm install into stock Node-RED works with zero FlowFuse account; features work with env keys only
- [ ] #7 [DECISION 5 RESOLVED] Package name: node-red-contrib-pi-assistant; package.json updated
- [ ] #8 node-red.plugins keys updated to node-red-contrib-pi-assistant and pi-assistant-completions
- [ ] #9 FlowFuse Assistant branded strings replaced with 'Node-RED AI Assistant' or similar
- [ ] #10 flowfuse backend kept as optional config (disabled by default) for parity testing
- [ ] #11 Apache-2.0 LICENSE preserved with FlowFuse attribution; pi (MIT) attribution added
- [ ] #12 README covers: install, DEEPSEEK_API_KEY env var, backend/model config, autocomplete (heuristics + LLM), privacy statement
- [ ] #13 CI: mocha tests pass; optional smoke test for pi backend behind env-gated flag
- [ ] #14 Clean npm install into stock Node-RED works with zero FlowFuse account; features work with DEEPSEEK_API_KEY only
<!-- AC:END -->

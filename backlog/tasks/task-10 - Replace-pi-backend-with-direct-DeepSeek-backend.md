---
id: TASK-10
title: Replace pi backend with direct DeepSeek backend
status: Done
assignee:
  - '@aaronmyatt'
created_date: '2026-07-03 14:44'
updated_date: '2026-07-05 14:31'
labels:
  - backend
  - ai
  - deepseek
dependencies: []
priority: high
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the current pi-coding-agent / pi-rpc path with direct server-side DeepSeek API calls from the Node-RED plugin. Keep the browser contracts stable so existing editor features keep calling the same Node-RED endpoints, but stop spawning pi and stop routing FIM through a full agent turn. This should improve latency, reduce moving parts, and keep provider credentials on the server side rather than in browser code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Method-based assistant routes continue to return the same response shapes expected by index.html.
- [ ] #2 FIM inline completions use direct DeepSeek requests without pi-coding-agent or a long-lived pi RPC subprocess.
- [ ] #3 DeepSeek credentials remain server-side only; no API key is exposed to browser code.
- [ ] #4 Plugin settings support selecting the DeepSeek model and request timeout for direct calls.
- [ ] #5 Relevant automated tests cover request shaping, response parsing, and failure handling for the new backend.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a direct DeepSeek AiBackend that calls DeepSeek's chat completions API from Node.js, reuses the existing prompt files, and preserves the current browser response shapes.
2. Wire assistant backend selection/config to support the new backend while keeping secrets server-side and making model/timeout configurable.
3. Add focused unit tests for backend request shaping/response parsing and assistant initialization with the DeepSeek backend.
4. Verify with automated tests, then restart Node-RED and smoke-test the server path before moving on to cleanup in TASK-11.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- Added a new direct DeepSeek AiBackend (lib/ai/backends/deepseek.js) that calls /chat/completions from Node.js, reuses the existing prompt files, preserves current response shapes, and trims FIM context server-side before sending it upstream.
- Wired assistant backend selection to support backend: "deepseek" with server-side DEEPSEEK_API_KEY, baseUrl/model/requestTimeout settings, and no pi subprocess required.
- Added unit coverage for direct-backend request shaping/response parsing plus assistant/settings support.
- Local smoke tests against the running Node-RED instance succeeded: /nr-assistant/json returned in ~1.7s and /nr-assistant/fim/... returned in ~1.8s using the direct backend.
<!-- SECTION:NOTES:END -->

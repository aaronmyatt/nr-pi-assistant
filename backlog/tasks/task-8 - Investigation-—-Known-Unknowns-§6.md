---
id: TASK-8
title: Investigation — Known Unknowns (§6)
status: Done
assignee:
  - '@aaronmyatt'
created_date: '2026-07-01 14:02'
updated_date: '2026-07-05 14:31'
labels:
  - investigation
  - discovery
milestone: m-0
dependencies:
  - TASK-1
references:
  - Migration plan §6 — Known unknowns
priority: high
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Investigate the four known unknowns from the migration plan §6 before building: (1) response data shapes per feature from client code, (2) system prompts to draft for pi, (3) pi RPC launch flags and protocol specifics, (4) pi-ai exact function signatures.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Data shapes documented per feature by reading expertActionsInterface.js, expertAutomations.js, index.html, completions.html
- [x] #2 System prompt drafts created in lib/ai/prompts/ for function-builder, JSON-gen, CSS/HTML-gen, FIM, explain-flow
- [x] #3 pi RPC CLI invocation flag identified; RpcCommand for plain prompt confirmed; text delta RpcResponse variant mapped
- [x] #4 pi-ai completeSimple/streamSimple argument shapes confirmed; model/provider/key resolution documented
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read client code (expertActionsInterface.js, expertAutomations.js, index.html, completions.html) to recover response data shapes per feature
2. Draft system prompts in lib/ai/prompts/ for each AI feature
3. Locate pi's RPC CLI launch flag and protocol specifics (rpc-types.ts, rpc-client.ts)
4. Confirm pi-ai completeSimple/streamSimple signatures
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#1: Response data shapes fully mapped from client code. Created lib/ai/prompts/response-data-shapes.md with exact contracts for all 8 AI features (function-builder, JSON-gen, CSS-gen, HTML-gen, SQL-gen, FIM, explain-flow, predict_next). Key finding: FIM is double-nested (res.data.data.fim_completion); explain_flow expects plain markdown string; function-builder expects { func, outputs?, node_modules? }.

AC#2: System prompt drafts created for all AI features: function-builder.md, json-generator.md, css-generator.md, html-generator.md, fim-completion.md, explain-flow.md, sql-generator.md. Each defines exact JSON response format the pi backend must produce.

AC#3: pi RPC launch: 'pi --mode rpc'. RpcClient exported directly from @earendil-works/pi-coding-agent with rich API: start(), stop(), prompt(), promptAndWait(), collectEvents(), getLastAssistantText(). Key method for stateless buffered use: promptAndWait(text, images?, timeout). RpcClient.start() spawns 'node dist/cli.js --mode rpc' with configurable provider/model via options.

AC#4: pi-ai does NOT export completeSimple/streamSimple as the plan assumed. The API is builder-style: createProvider({models, api}) + createModels({...}) + lazyApi(load). For stateless completions, RPC is simpler. pi-ai also provides envApiKeyAuth(name, envVars) for env-based API key resolution and InMemoryCredentialStore for key storage. Key signature findings documented in investigation.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Investigation complete. (1) Response data shapes mapped for all 8 AI features in lib/ai/prompts/response-data-shapes.md. Key findings: FIM is double-nested, explain_flow expects plain markdown, function-builder expects {func, outputs?, node_modules?}. (2) System prompt drafts created for all 7 AI features in lib/ai/prompts/. (3) pi RPC launch: 'pi --mode rpc'. RpcClient.promptAndWait() is the simplest path for stateless buffered completions. (4) pi-ai does NOT have completeSimple/streamSimple as plan assumed; it uses builder-style createProvider+createModels+lazyApi. RPC approach is simpler for v1.
<!-- SECTION:FINAL_SUMMARY:END -->

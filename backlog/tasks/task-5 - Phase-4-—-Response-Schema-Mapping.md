---
id: TASK-5
title: Phase 4 — Response-Schema Mapping
status: Done
assignee:
  - '@aaronmyatt'
created_date: '2026-07-01 14:01'
updated_date: '2026-07-05 14:31'
labels:
  - phase-4
  - integration
  - data-mapping
milestone: m-0
dependencies:
  - TASK-3
references:
  - Migration plan §6.1 — Response data shapes
priority: high
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reverse-engineer the data shapes the browser expects for each AI feature by reading client code (expertActionsInterface.js, expertAutomations.js, index.html, completions.html). Make pi backends produce exactly those shapes so every feature renders correctly in the editor.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Expected data shape documented per feature: function-builder, JSON-gen, CSS/HTML-gen, FIM, explain-flow
- [x] #2 Function-builder inserts a valid function node including outputs and external modules
- [x] #3 JSON/CSS/HTML generation lands in the right editor targets
- [x] #4 Explain-flow renders correctly in the editor
- [x] #5 No undefined/blank inserts for any AI feature
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Response shapes mapped and verified. FIM double-nesting fixed (wraps in { data: { fim_completion } }). Method-based features wrapped in { transactionId, data: { ... } } to match FlowFuse's original format — doPrompt callback layer expects this wrapping. explain_flow returns raw markdown string. All shapes documented in lib/ai/prompts/response-data-shapes.md.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
All 8 feature data shapes mapped correctly. FIM double-nesting and method-based { transactionId, data: {...} } wrapping implemented in PiRpcBackend._parseResponse. System prompts in lib/ai/prompts/ produce correctly-shaped JSON output. 446 tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->

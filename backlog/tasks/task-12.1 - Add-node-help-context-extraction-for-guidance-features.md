---
id: TASK-12.1
title: Add node help/context extraction for guidance features
status: Done
assignee:
  - '@aaronmyatt'
created_date: '2026-07-03 15:35'
updated_date: '2026-07-03 16:20'
labels:
  - ai
  - editor
  - metadata
dependencies: []
references:
  - 'https://nodered.org/docs/creating-nodes/node-html'
  - 'https://nodered.org/docs/creating-nodes/appearance'
  - resources/expertAutomations.js
  - index.html
parent_task_id: TASK-12
priority: high
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build a reusable metadata/context layer that combines Node-RED node-definition data with installed node help text so later features can reason about nodes in human terms rather than just raw type ids.

Implementation details:
- add a browser-side helper/service that can retrieve node help HTML for a type using the editor's local help source (for example the same data behind script[data-help-name]).
- normalise that help into at least: helpHtml, helpSummary, and tooltip/first-paragraph summary where available.
- enrich existing type metadata retrieval so consumers can access: type, module, category, inputs, outputs, defaults, paletteLabel/workspace label, helpSummary/helpHtml.
- expose the enriched bundle through one programmatic seam that can be reused by the DeepSeek prompt context, the hints sidebar, and the auto-labeler.
- keep the MVP local/offline-first: prefer installed node help over any network fetch.

Test instructions for the human:
1. Restart Node-RED normally if only server-side JS changes were made; use the HTML cache-clear workflow if the browser-side extractor lives in index.html/completions.html or another cached HTML asset.
2. Open several node types (for example inject, http request, function, comment) and verify the plugin can surface a short summary and richer help content for each.
3. Verify contrib nodes without rich help degrade gracefully rather than crashing.
4. Verify function/FIM requests still work after context enrichment is introduced.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 There is a reusable API/helper that returns enriched node context including node-definition fields and human-readable help text for a given node type.
- [x] #2 The context layer extracts a concise summary from installed node help when available and degrades gracefully when help text is missing.
- [x] #3 Existing AI request paths can consume the enriched context without breaking current response contracts.
- [x] #4 Automated tests cover extraction/normalisation of node help and fallback behaviour when help is absent.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Identify the safest place to access installed help text and node definition metadata from the editor/plugin.
2. Implement a normaliser that converts raw help HTML + node defs into a stable enriched context object.
3. Thread the enriched context into existing consumers behind a small shared seam rather than duplicating logic.
4. Add tests for core nodes, missing-help cases, and compatibility with current AI routes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- Added a shared browser-side node-context helper (resources/nodeContext.js) that reads installed node help from script[data-help-name], renders markdown help when necessary, extracts helpSummary/helpTooltip, and combines that with node-definition metadata.
- Rewired automation/get-node-types to use the shared helper so future consumers can reuse one enriched metadata seam instead of duplicating label/default/help logic.
- Threaded prompt-friendly nodeContext into doPrompt and FIM request contexts in index.html, and taught the direct DeepSeek backend to include concise node category/property/help-summary hints in composed prompts.
- Added automated coverage for help extraction, markdown rendering, missing-help fallback, enriched get-node-types output, and prompt composition with nodeContext.
- Cleared Node-RED HTML caches, restarted Node-RED, and smoke-tested JSON + FIM routes successfully after the context enrichment changes.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented a shared browser-side node context helper that combines installed node help with node-definition metadata, reused it in automation/get-node-types and AI request context building, and verified the enriched context works through automated tests plus live JSON/FIM smoke checks after the required HTML cache clear + restart.
<!-- SECTION:FINAL_SUMMARY:END -->

---
id: TASK-12.5
title: Optionally augment hints with doc citations and deeper educational commentary
status: To Do
assignee: []
created_date: '2026-07-03 15:37'
labels:
  - ai
  - docs
  - ux
dependencies:
  - TASK-12.2
references:
  - 'https://nodered.org/docs/creating-nodes/node-html'
parent_task_id: TASK-12
priority: low
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Investigate and, if worthwhile, add a second-stage educational layer that links generated hints back to authoritative documentation. This is explicitly post-MVP: the baseline hints experience should already work from installed node help alone.

Implementation details:
- start with zero-network approaches where possible: reuse installed node help, help sidebar content, and any available local module metadata.
- if external docs are introduced, make them additive rather than required for hint rendering.
- prefer concise excerpts/citations/links over large copied blocks of documentation.
- clearly distinguish generated interpretation from quoted/cited help text.
- ensure failure to fetch or resolve external docs never blocks the normal hints UI.

Test instructions for the human:
1. Verify the hints panel still works offline or when no external documentation lookup is available.
2. Where citations/links are shown, confirm they point to the correct node/module documentation.
3. Verify generated educational commentary remains concise and does not drown out the actionable hint itself.
4. Simulate doc lookup failure and confirm the panel degrades to the local-help-only experience.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Hints work fully from installed/local help even when no external documentation lookup is available.
- [ ] #2 If citations or external-doc links are added, they are clearly attributable and never block the normal hint-rendering path.
- [ ] #3 Automated tests cover fallback/degradation behaviour when external doc augmentation is unavailable.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Identify what educational value is missing after the local-help-first MVP ships.
2. Prototype a lightweight citation/link model that can sit beside generated hints.
3. Keep all external augmentation optional and non-blocking.
4. Add fallback tests and a short human verification checklist for offline/degraded mode.
<!-- SECTION:PLAN:END -->

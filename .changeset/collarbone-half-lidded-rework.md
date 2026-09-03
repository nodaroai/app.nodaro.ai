---
"@nodaro/prompts": patch
---

Reword the two `person` picker hints the original W1-b rephrase (2026-09-01 app-reports triage) left byte-identical — `eye-state-half-lidded` and `feature-collarbone-visible` — because the replay harness could not confirm their approved rewording rendered on the model (0/10 and 0/22). A follow-up staging replay found wordings that DO render, approved 2026-09-03: `eye-state-half-lidded` now reads `"with drowsy, partly closed eyes, the lids sitting low over the iris"`, and `feature-collarbone-visible` now reads `"with an open neckline that leaves the collarbones uncovered"`. `label`, `description`, `term` and `adultOnly` are unchanged on both entries.

The minor-age floor did not narrow: both entries' pre-rework `promptHint` strings were already in `RETIRED_ADULT_ONLY_HINT_STRINGS` (added alongside the rest of W1-b's flagged hints as "harmless double coverage" at the time), so a client still on an older `@nodaro/prompts` is stripped exactly as before, and the new wording is a live needle too via the same `adultOnly` derivation.

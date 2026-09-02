---
"@nodaro/prompts": minor
---

Adult output CHANGES in this release — supersedes the "Adult output is unchanged" note from the minor-age floor changeset, which ships in the same version.

Sixteen picker-catalog hints are reworded to describe the garment or the look rather than exposed skin (person: `bust-very-full`, `silhouette-hourglass`, `waist-defined`, `lip-state-glossy`, `lip-state-parted`, `lip-state-bitten`, `texture-glistening`, `texture-shower-fresh-wet`, `texture-dewy`, `texture-baby-soft`, `eye-state-staring-camera`, `feature-bare-shoulders`, `feature-midriff-visible`; styling: `state-fitted`, `state-wet`; pose: `biting-lip`), plus the hard-coded midriff+navel fold clause. Both `promptHint` and `term` change on every reworded entry. Two entries the replay harness could not validate (`eye-state-half-lidded`, `feature-collarbone-visible`) keep their current wording. A cross-catalog de-stack now emits at most one "cropped" clause per subject.

The minor-age floor did not narrow: `RETIRED_ADULT_ONLY_HINT_STRINGS` keeps every pre-rephrase string in the strip set, so a client still on an older `@nodaro/prompts` (client-assembled seed prompts) is stripped exactly as before, and the new wording is a live needle too. Thin clients should bump to this release and re-validate any prompt snapshots.

---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

`audio.mix` accepts an optional `duck`: every track except `duck.under` (the voice) dips while that track is loud and rises back in its pauses, so a music bed sits under speech. `amount` (0-100) sets how hard; `thresholdDb`, `ratio`, `attackMs` and `releaseMs` are optional fine controls. The CLI gains `nodaro audio mix --duck-under <index> [--duck-amount <0-100>]`. Additive; a mix without `duck` is unchanged.

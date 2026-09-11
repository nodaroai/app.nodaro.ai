---
"@nodaro/shared": minor
"@nodaro/prompts": patch
---

Suno V6 family (V6, V6 Wild, V6 Mini) — the new default generation.

`SUNO_MODELS` is now V6-first: new exports `SUNO_ACTIVE_MODELS`
(`V6` / `V6_WILD` / `V6_MINI`), `SUNO_LEGACY_MODELS` (the earlier
generations, still offered and accepted everywhere), `DEFAULT_SUNO_MODEL`
(`V6`), `SUNO_DURATION_MODELS`, `isLegacySunoModel`, `sunoModelHonoursDuration`
and `SUNO_VERSION_CREDIT_KEYS`. Three catalog capability sheets — `suno-v6`,
`suno-v6_wild`, `suno-v6_mini` — at 30 credits per generation, the same price
as every earlier version.

`duration` (custom mode) is honoured only by the V6 family; ask
`sunoModelHonoursDuration(model)` rather than testing a version string.

Every earlier version (`V5_5` and older) remains a first-class choice; only the
default moves to V6.

The built-in music presets (`@nodaro/prompts`) now default to Suno V6.

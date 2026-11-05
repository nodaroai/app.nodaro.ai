---
"@nodaro/sdk": minor
---

`SafetyBlockHint.subject` gains `"prompt"`: the provider's own words named the prompt in its refusal, so changing the prompt is the fix. It also gains `"audio"`: the provider's own words blamed the generated audio, not the picture. Treat a `subject` you do not know as absent. `CastSwapStyleChoice` gains `preciseArtStyleAlone`: per engine, whether an art style alone is a Precise run's change; Nodaro may run such a request as a Flex run, which it does not say; it answers `false` until the engine takes such runs, and a server from before it leaves it out (read as `false`).

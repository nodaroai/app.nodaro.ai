---
"@nodaro/shared": minor
---

Gemini Omni Flash 1.2 (`gemini-omni-flash-1-2`) takes character references.

- `VIDEO_REF_LIMITS_BY_PROVIDER["gemini-omni-flash-1-2"]` now declares `characters: 2`, so `videoCharacterRefCap()`, `videoCharacterRefProviders()` and `videoCharacterRefProblem()` accept up to two `characterReferences` on it. `VIDEO_CHARACTER_REFS_WIRE_MAX` is unchanged.
- New optional limits key `charactersOutsideImageBudget`: the model's characters count toward no input budget. `videoCharacterRefProblem()` skips the 7-unit Gemini Omni budget for such a model and still refuses a start or end frame beside characters (with a sentence that says the platform does not combine them on that model) and a `voice` on a model with no `voices` cap.
- New optional limits key `characterIdScope`: a scope the provider layer adds to its cached character ids, so an id minted for that model is never served to another. Set on Gemini Omni Flash 1.2.
- The `character_voice_unsupported` message now names the models that take a pinned voice.

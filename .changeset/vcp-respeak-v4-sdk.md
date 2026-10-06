---
"@nodaro/sdk": minor
---

`VoiceChangerProVoice.engine` (the per-voice setting of `voices.recast`) now also takes `"v4"`: Re-speak on the newer model — the performance is regenerated from the transcript like `"v3"`, with any `stability` from 0 to 1 and `similarityBoost` honoured (`style` / `useSpeakerBoost` ignored); each line is generated with its neighbouring lines as context for smoother joins. Priced like a `"v3"` Re-speak voice, per started 1,000 characters. `"v3"` is unchanged. Requires a Nodaro Cloud release that accepts the engine.

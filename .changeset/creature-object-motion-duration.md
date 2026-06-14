---
"@nodaro/client": minor
---

Add an optional `duration` (seconds) field to `GenerateCreatureMotionInput` and `GenerateObjectMotionInput`, mirroring `generate-video`'s per-model i2v duration lever. The value is validated server-side against the chosen provider's allowed durations (`POST /v1/generate-creature-motion` / `/v1/generate-object-motion`) and passed through to the underlying video model; when omitted the model's own default is used, so there is no behavior change for current callers. Longer clips on duration-priced models (kling, kling-3.0, wan-i2v, seedance, …) reserve credits at the correct duration tier.

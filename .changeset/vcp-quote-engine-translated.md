---
"@nodaro/shared": minor
---

`voiceChangerProQuoteCreditId` names each Re-speak slot's engine and whether it speaks a translation (`respeak-v4-<chars>`, `respeak-v4t-<chars>`); `parseVoiceChangerProQuoteCreditId` returns `respeakEngines` and `respeakTranslated` beside the counts. Ids without an engine keep their meaning (the default engine, v3).

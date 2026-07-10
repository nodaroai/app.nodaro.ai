---
"@nodaro/sdk": minor
---

Voice Changer Pro: `VoiceChangerProInput.orderedVoices` now accepts `null` entries (keep-slots). A `null` at position i means "keep speaker i's original voice" instead of recasting it. Additive — existing non-null callers are unaffected.

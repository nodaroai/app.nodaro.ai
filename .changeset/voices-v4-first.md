---
"@nodaro/shared": patch
---

`SharedVoice.recommendedProvider` / `verifiedProviders` (from `GET /v1/voices/library`) now document the new recommendation order: a Voice Library entry verified for ElevenLabs v4 recommends `elevenlabs-v4` first, then `elevenlabs-v3`, `elevenlabs-turbo`, `elevenlabs-multilingual`. Only the base model id `eleven_v4` counts toward v4; its `eleven_v4_…` variants do not. Both fields only name models the deployment offers, and are absent when none of a voice's verified models is offered. Documentation only: no type or export changed.

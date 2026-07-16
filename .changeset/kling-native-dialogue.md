---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

Kling native dialogue: `VIDEO_AUDIO_CAPABILITY` upgrades `kling` (2.6) and `kling-3.0` from `ambient` to `native_speech` (probe-verified on the KIE path: scripted quoted dialogue is spoken verbatim with lip sync behind the `sound` toggle) and adds a `kling-3-omni` entry (`native_speech`, `generateAudio` lever). New optional `VideoAudioCapability.defaultOn` flag mirrors each model's own audio default; `buildVideoCreditModelIdentifier` now falls back to it when `sound` is omitted, so intent-less kling-3.0 requests bill the `:audio` tier their generation actually produces (pass `sound: false` for the silent tier). `@nodaro/prompts` gains a Kling 2.6/3.0/Omni audio-prompting doctrine (dialogue labeling, voice/tone control, Audio block, element refs, limits).

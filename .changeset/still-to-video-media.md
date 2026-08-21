---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Still to Video: `client.media.stillToVideo({ imageUrl, audioUrl, motion?, intensity?, resolution?, aspectRatio?, fps?, fit?, padColor? })` and `nodaro media still-to-video` — one still image + one audio track → MP4 via `POST /v1/still-to-video`, locally rendered (FFmpeg), zero credits. The output duration is the audio's duration (no duration field); optional motion presets (zoom / pan / ken-burns) with intensity 1–10.

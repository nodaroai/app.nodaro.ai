---
"@nodaro/sdk": minor
---

Two new SDK namespaces for the media/audio building blocks a Voice Changer Pro flow composes. `client.media`: `downloadVideo` (social-video import, with range/section fetch), `saveToStorage` (copy a URL into storage), `trimVideo`, `trimAudio`, and `videoMetadata` (probe duration/dimensions without downloading). `client.audio`: `separate` (Demucs stems), `isolate` (denoise/voice-isolate), `applyFx` (reverb/echo/telephone/megaphone), `mix` (layer tracks), `adjustVolume`, and `combine` (concatenate segments). Each generation op returns a job id to poll; `videoMetadata` is a direct read. New exported `VideoMetadata` type.

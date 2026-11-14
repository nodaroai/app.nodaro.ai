---
"@nodaro/shared": minor
---

Kling 4.0 Flash prices a character's video subject like an image subject: it adds no reference-video seconds and does not move a run onto the reference-video rate. The clip still counts toward the model's 5 videos and the videos' 2–20 s total. Kling 4.0 keeps pricing a video subject as a reference video.

- `VIDEO_REF_LIMITS_BY_PROVIDER` rows gain `videoCharactersBillAsReferenceVideo`, set on `kling-4`: the provider bills a video subject's clip as reference-video seconds. Absent, a video subject is priced like an image subject.
- New from `@nodaro/shared/video`:
  - `videoCharacterClipsBilledAsReferenceVideo(provider)`, which reads that flag;
  - `pricedReferenceVideoUrls({ provider, referenceVideoUrls, characterReferences })`, the reference videos a run is priced on. It returns the sent list without the seats that are a character's clip, on a model that does not bill them, and returns the same value when nothing is removed.

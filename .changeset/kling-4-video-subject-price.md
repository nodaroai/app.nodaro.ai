---
"@nodaro/shared": patch
---

Kling 4.0 prices a character's video subject like an image subject, as Kling 4.0 Flash does: it adds no reference-video seconds and does not move a run onto the reference-video rate. The clip still counts toward the model's 5 videos, the videos' 30 s total and its 3–8 s limit. The `kling-4` row of `VIDEO_REF_LIMITS_BY_PROVIDER` no longer sets `videoCharactersBillAsReferenceVideo`, so no model sets it today. The field, `videoCharacterClipsBilledAsReferenceVideo` and `pricedReferenceVideoUrls` stay, for a model whose provider bills the clip as reference video.

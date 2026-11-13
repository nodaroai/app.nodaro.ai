---
"@nodaro/shared": minor
---

Video subjects on Kling 4.0 and Kling 4.0 Flash: a character can be made from a short clip of itself.

- `VideoCharacterReference.videoUrl` (optional): a 3–8 s single-shot clip of the character. On a model that takes video subjects the character is sent as a subject built from that clip. The clip rides as one of the run's reference videos, so it is measured, limited and billed exactly as a reference video.
- New from `@nodaro/shared/video`:
  - `seatCharacterVideos({ provider, referenceVideoUrls, characterReferences })` returns the reference-video list with each character's clip added. It refuses, with a code and a sentence: a model that takes none, more clips than the model's cap, two characters on one clip, and reference videos plus clips over the model's video cap. On a model that takes video subjects, plain reference videos alone past its cap are refused too (`reference_videos_over_limit`), where a 6th one used to be left out silently.
  - `characterVideoUrls`, `videoCharacterVideoCap`, `videoCharacterVideoProviders`, and the `CharacterVideoSeatProblem` type.
  - `wiredCharacterSubjectClips(consumerId, nodes, edges, provider)`: the clips a Generate Video run sends as its characters' video subjects, read off the graph (a character that gives an image, the model's first characters, none on a model that takes no video subjects) — for an estimate that must name exactly the run's clips.
  - `characterReferencesFromWired` takes an optional map of clips by character slug.
- New from `@nodaro/shared/models`:
  - `VIDEO_CHARACTER_CLIP_DURATION_LIMITS` (3–8 s on `kling-4` and `kling-4-flash`) and `checkCharacterClipDurations`. A character's clip must be measured to be accepted: one the probe could not read is refused as `character_video_unreadable`, where a plain reference video is not. A clip of the wrong length is refused with its measured length rounded up to hundredths ("8.03 s").
  - `VIDEO_REF_LIMITS_BY_PROVIDER` rows gain `videoCharacters`, the most characters that may be made from a video (3 on both Kling 4.0 ids).
- New from `@nodaro/shared/entities`: `wiredCharacterVideoUrls(consumerId, nodes, edges)`, the clip each Character node wired into a node carries (its `subjectVideoUrl`), by the slug it goes by.

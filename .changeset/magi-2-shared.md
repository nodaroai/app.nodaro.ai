---
"@nodaro/shared": minor
---

MAGI-2 (`magi-2`), a new video model by Sand AI (the new `MODEL_MAKERS` id `sand-ai`): 1080p video with its sound in one pass, 4–30 s in whole seconds (default 5), from text, a first frame with an optional last frame, or up to 10 image / 5 video / 5 audio references (a prompt with reference audio alone works). It is in `IMAGE_TO_VIDEO_PROVIDERS` and `TEXT_TO_VIDEO_PROVIDERS`, priced per second by `buildVideoCreditModelIdentifier` as `magi-2:<N>s:1080p` (any resolution reads as 1080p), and offered on Generate Video Pro (keyframes). Its reference limits are in `VIDEO_REF_LIMITS_BY_PROVIDER` (a request over them is refused), `VIDEO_REF_VIDEO_DURATION_LIMITS` and `VIDEO_REF_AUDIO_RULES` (2–30 s a clip, 30 s together; other audio formats are converted to MP3), and `videoProviderFoldsLoneEndFrame("magi-2")` is true.

New: `MAGI_2_PROVIDERS`, `isMagi2Provider`, `MAGI_2_RESOLUTION`, and `VIDEO_REF_VIDEO_FORMATS` with `refVideoFormatProblem` — the containers a model takes a reference video in (MAGI-2: MP4 or MOV), so a clip in another one is refused before anything is held.

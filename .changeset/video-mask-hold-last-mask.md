---
"@nodaro/shared": minor
"@nodaro/sdk": patch
"@nodaro/cli": minor
---

Video Mask takes `holdLastMask` (default false): frames where the subject is lost — a mask covering under 0.002 % of the picture (`VIDEO_MASK_LIMITS.HOLD_EMPTY_BELOW_FRACTION`) — repeat the most recent non-empty mask; frames before the first detection stay empty, and the frame count, rate and size are unchanged. `VIDEO_MASK_DEFAULTS` and `VideoMaskRequest` gain the field; the job output reports `heldFrames` when it is on. `nodaro media video-mask` gains `--hold-last-mask`.

Video Mask also takes `minSubjectHeightPct` (0–100, default 0 = off): every connected region (8-connected) whose bounding box is shorter than that % of the frame height is dropped from each frame, before `holdLastMask` — so a frame left with only small regions is held from the last frame with a big subject. `VIDEO_MASK_LIMITS` gains `MIN_SUBJECT_HEIGHT_PCT_MIN` / `MAX`; the job output reports `droppedRegions` when it is on. `nodaro media video-mask` gains `--min-subject-height <pct>`.

Video Mask also takes `maxSubjectHeightPct` (0–100, default 0 = off), the mirror of the minimum: regions TALLER than that % of the frame height are dropped, in the same pass and before `holdLastMask`. With both set a region is kept when min ≤ height ≤ max; min > max is refused (400). `VIDEO_MASK_LIMITS` gains `MAX_SUBJECT_HEIGHT_PCT_MIN` / `MAX`. `nodaro media video-mask` gains `--max-subject-height <pct>`.

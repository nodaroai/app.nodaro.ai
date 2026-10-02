---
"@nodaro/shared": minor
---

Video Analysis and AI Audit price a clip with a 3-second grace at each bucket edge: a video up to 1:03 is priced as up to a minute, up to 3:03 as up to three minutes, and so on. A part cut at 1:00 from a longer YouTube video downloads at about 1:03, because the cut lands on keyframes, and is now priced as the minute it was chosen as.

- `VIDEO_ANALYSIS_BUCKET_GRACE_SEC` (3) is the grace, read by `pickVideoAnalysisBucket`, and through it by `buildVideoAnalysisCreditId` and `buildVideoAuditCreditId`.
- `VIDEO_ANALYSIS_DURATION_TOLERANCE_SEC` is now 6, the grace plus 3 seconds of measurement drift. The worker's re-check (`bucket + tolerance`) therefore never refuses a clip the grace priced into a bucket, at its true length.

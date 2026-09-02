---
"@nodaro/shared": minor
---

`VIDEO_REF_VIDEO_DURATION_LIMITS` + `checkRefVideoDurations(provider, durationsSec)` — per-provider reference-video duration bounds, alongside the existing reference-COUNT caps in `VIDEO_REF_LIMITS_BY_PROVIDER`. Both video routes already ffprobe reference videos to price a run; the durations are now checked against the provider's limits so an out-of-bounds clip is a 400 before the job exists instead of a post-payment provider reject ("Each reference video must be between 2 and 30 seconds"). Data-driven like the reference-audio cap: only providers with a verified documented limit are listed, so an unknown provider is never false-rejected, and a failed probe (a non-finite or non-positive duration) is ignored rather than turned into a user-facing rejection. Two providers are declared: `seedance-2-5` (2–30s per clip, ≤30s total) and `minimax-h3` (2–15s per clip, ≤15s total — the bound behind "video duration 52838 ms, expected [2000, 15000] ms").

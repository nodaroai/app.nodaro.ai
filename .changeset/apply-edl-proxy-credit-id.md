---
"@nodaro/shared": minor
---

New: `applyEdlCreditId(quality)` names the credit row an Apply EDL render is priced on: `"apply-edl:proxy"` for a `proxy` render (the 720p preview, for a video and an audio output alike), `"apply-edl"` for a final render and for anything that is not exactly `"proxy"`. Both are per-minute rates; the job itself is always named `apply-edl`.

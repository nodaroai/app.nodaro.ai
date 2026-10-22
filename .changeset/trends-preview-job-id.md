---
'@nodaro/sdk': minor
---

`client.trends`: `TrendRunRequest.previewJobId?` (a uuid) — on a full run, the `jobId` of your own completed preview run of the same trend. When that preview showed the clip needs its faces masked, the full run masks them from the start (and `estimate()` prices it that way); any other job is ignored without an error. `TrendEstimate.maskingCredits?`: on a trend that masks faces only when needed, the credits charged on top if the video model refuses the clip and the run is retried with the faces masked. It is not part of `expectedCredits` or `holdCredits`, and `breakdown.masking`, listed beside it, is not either.

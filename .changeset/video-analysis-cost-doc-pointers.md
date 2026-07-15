---
---

Doc-only: repoint the video-analysis pricing comments in `@nodaro/shared`
(`video-analysis-pricing.ts` + its test) at the private `@nodaroai/cloud-plugins`
formula — the `$`-derived `videoAnalysisBucketCredits` formula + measured-rate
constants moved out of the app repo. No API or behavior change; the precomputed
`VIDEO_ANALYSIS_BUCKET_CREDITS` table is byte-identical. No release needed.

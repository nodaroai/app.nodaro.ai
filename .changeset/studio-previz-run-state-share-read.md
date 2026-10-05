---
"@nodaro/shared": minor
---

Add `STUDIO_PREVIZ_RUN_STATE_KEYS` (`pendingJobs`, `proSubmission` — a studio scene's 3D previsualization runs in flight and its 3D Render Pro submission). `stripStudioTransientSettings`, the public share read's strip, now removes them from every scene's `previsualization`, as the studio production codec's own non-owner projection does; finished renders and an unadopted result stay. `stripStudioDraftSettings` (the `view` read) is unchanged and keeps them, as the codec's read-only load does.

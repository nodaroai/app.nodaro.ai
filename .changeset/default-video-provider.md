---
"@nodaro/shared": minor
---

Add the platform's single-source video default: `DEFAULT_VIDEO_PROVIDER` (`seedance-2-fast`), `DEFAULT_VIDEO_DURATION_SEC` (4), and `applyDefaultVideoSelection()` — used by the generate-video/text-to-video routes, the DAG payload builder, and the KIE provider fallback. Previously the route default (`minimax`) and the DAG default (`kling`) disagreed; a nothing-specified request now resolves to `seedance-2-fast:4s:480p` (16 credits), guarded by tests in shared + billing.

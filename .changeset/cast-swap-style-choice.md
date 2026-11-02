---
"@nodaro/sdk": minor
---

Nodaro Motion: `castSwap.styleChoice()` (`GET /v1/cast-swap/style-choice`, public) answers, per engine, whether people choose a direct run's style or an admin forced one (`CastSwapStyleChoice`: `{ engines: { "motion-prism", "motion-pulse" } }`, each a `CastSwapStyleChoiceOption`: `"user"`, `"precise"` or `"flex"`). A forced style overrides a run's `style`, so a client hides its Style control for that engine.

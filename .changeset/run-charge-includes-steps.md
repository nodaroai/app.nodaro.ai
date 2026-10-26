---
"@nodaro/sdk": minor
---

A job's `credits_charged` now includes the steps it ran (the child jobs a run such as Nodaro Motion makes for its reference preparation, mask and video), and jobs carry `credits_held` (the run's hold, its steps' included) and `credits_released` (what went back once every hold in the run settled). A trend run's `creditsCharged` includes its steps the same way, beside `creditsHeld` and `creditsReleased`.

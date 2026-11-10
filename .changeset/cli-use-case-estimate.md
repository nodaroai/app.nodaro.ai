---
"@nodaro/cli": minor
---

`nodaro edit tighten-episode`, `episode-chapters`, `episode-trailer`, `clip-pack` and `speaker-layout` take `--estimate`: the same flags, quoted by the node's `/estimate` route instead of starting the run. Nothing is created or charged. It prints the total (`≈` when a step is a metered estimate), the steps, the per-run fee and the recording's length; `--json` prints the route's `{ totalCredits, stepsCredits, feeCredits, estimate?, durationSec }`. On an edition without credits it says so.

`nodaro edit capabilities` prints the Edit Plan modes this server can plan, who answered and whether Edit Plan is charged per started minute (`GET /v1/edit-plan/capabilities`, through the SDK's `editPlanCapabilities()`); `--json` prints the route's `{ modes, source, perMinute }`.

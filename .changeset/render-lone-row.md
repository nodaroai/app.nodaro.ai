---
"@nodaro/shared": minor
---

`renderLoneRow(renderId, nodes, edges, batchOf)`: the row a render run once reads behind a pass-through node (Camera Switch) whose batch has exactly one delivered row — so a multicam Clip Pack whose every clip's Camera Switch but one failed still stamps that clip's `clipKey` and plan basis. Pass `row ?? renderLoneRow(…)` to `renderPlanClipKey` / `renderPlanBasis`. Additive.

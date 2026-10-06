---
"@nodaro/shared": patch
---

`renderPlanValue`, `renderClipKey`, `renderPlanClipKey` and `renderPlanBasis` follow a clip set with dropped clips (`""` or `null` at each). Behind Camera Switch a render's row k is the k-th KEPT clip of the switch's selection (the switch runs once per kept clip and hands on its batch in that order), no longer row k of the plan. A render that runs once names the one kept clip when only one is left, and a Selected wire from an Edit Plan names its first kept clip, as both engines read them.

---
"@nodaro/shared": minor
---

`editPlanResultPatch(plan, editedEdl)` is what a result writer writes when a plan lands on an Edit Plan node: the plan, and `editedEdl: undefined` only when the review was made on a different plan (its `basis` is not the landing plan's `editPlanBasis`). The same plan landing again keeps the review. Additive.

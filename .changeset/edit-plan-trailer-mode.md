---
"@nodaro/shared": minor
---

`EditPlanMode` gains `"trailer"`: one short teaser EDL built from a recording's strongest moments. `EDIT_PLAN_MODES` lists it, `asEditPlanMode` keeps it, and `buildEditPlanCreditId` builds its `edit-plan:trailer:<tier>:<bucket>m` id. `unwrapEditPlanOutput` returns a trailer plan as one `Edl`, like tighten. Additive.

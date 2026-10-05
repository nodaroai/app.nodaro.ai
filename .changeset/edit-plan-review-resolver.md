---
"@nodaro/shared": minor
---

An Edit Plan's review edit has one resolver. `resolveEditPlanOutput(plan, editedEdl)` applies a person's review to the plan (`{json, listResults?, status}`), and `editPlanSavedOutput(data)` is the saved-output read every edit-plan reader makes. A review edit (`EditedEdl`: `EditedEdlCut` for a Tighten plan, `EditedClipSet` for a clip set, holding `{keep, hook?}` decisions) is fingerprinted with `editPlanBasis(plan)`, an FNV-1a-64 hash of the plan's key-sorted JSON, so an edit made against another plan is ignored. A clip set's list stays on the plan's indices, with `""` at each dropped clip. `validateEditedEdl(editedEdl, plan)` checks an edit before it is saved. `editedEdl` joins `EXECUTION_DATA_KEYS`. Also `EDITED_EDL_VERSION`, `EditedClipDecision`, `EditPlanEditStatus`, `EditPlanSavedOutput` and `ResolvedEditPlanOutput`. Additive.

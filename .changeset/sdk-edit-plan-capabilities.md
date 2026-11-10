---
"@nodaro/sdk": minor
---

`client.edit.editPlanCapabilities()` reads `GET /v1/edit-plan/capabilities`: the Edit Plan modes this server can plan (`modes`), who answered (`source`: `server`, `nodaro.ai` or `nodaro.ai-unreachable`) and whether Edit Plan is charged per started minute (`perMinute`), typed as the new `EditPlanCapabilities`. A mode it does not list is refused by `editPlan` before anything is charged.

---
"@nodaro/sdk": patch
"@nodaro/cli": patch
---

**@nodaro/sdk**

- `ModelSummary.pricing` is now optional — `GET /v1/models` (and the MCP `list_models` twin) omit per-variant credit pricing on editions without a credit system (community/business), the same principle `/v1/nodes` applies to `creditCost`. JSDoc on `NodeDescriptor.creditCost` and on `workflows.delete()` / `developerApps.delete()` now states the edition behavior and the `NotFoundError` thrown when the id doesn't exist or isn't yours.

**@nodaro/cli**

- `nodaro models list` renders `-` in the credits column for models served without pricing (creditless editions) instead of crashing on the missing field.

---
"@nodaro/shared": minor
"@nodaro/sdk": minor
---

Pipelines: `approveSubGate` could never clear Stage 6's `match_cut_break_pending`. The sub-gate routes only resolve Stage 7's gates, and that gate clears one break at a time.

- `@nodaro/shared`: `ANIMATE_SUB_GATES` / `AnimateSubGateSchema` / `AnimateSubGate` are the sub-gates `POST /v1/pipelines/:id/sub-gates/:gate/{approve,reject}` resolves (`silent_cut_preview`, `dialogue_recheck`), and `MATCH_CUT_BREAK_GATE` names the one that clears per break. The routes answer the match-cut gate with a 400 `invalid_sub_gate` that names the helper route, instead of a 404 or 409.
- `@nodaro/sdk`: `pipelines.acceptMatchCutBreak(id, sceneId, shotId)` accepts one break (`POST /v1/pipelines/:id/entities/:sceneId/helpers/accept_match_cut_break`) and returns how many are left. `approveSubGate` now takes an `AnimateSubGate`.
- `@nodaro/sdk`: the entry point exports the types its resources re-export but it did not: `PipelineInput`, `PipelineStatus`, `PipelineMode`, `SubGateName`, `AnimateSubGate`, `ChatEnabledStage`, `ProposedChange` and `CommunityFullDetail`.

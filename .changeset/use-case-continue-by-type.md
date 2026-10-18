---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

`client.edit.continueUseCase` continues a run on its own node type's route (`POST /v1/<type>/continue`). It takes an optional `nodeType`; without one it reads the job first (`GET /v1/jobs/:id`) for the type the run records, and when that read cannot tell (a token without `jobs:read`, or a job that records no use-case type) the type must be passed as `nodeType`. New exports: `UseCaseNodeType`, `USE_CASE_NODE_TYPES`, and `UseCaseJobResult` / `UseCaseEstimate` (the `TightenEpisodeJobResult` / `TightenEpisodeEstimate` shapes, which stay as aliases). The CLI's `nodaro edit continue-use-case` takes an optional `--type <type>`, passed through so the job is not read for it.

---
"@nodaro/sdk": minor
"@nodaro/cli": patch
---

`USE_CASE_NODE_TYPES` is now `@nodaro/shared`'s list (`@nodaro/shared/nodes`), re-exported as before, and `continueUseCase` builds each continuation route from it (`POST /v1/<type>/continue`). `continueUseCase` rejects with `use_case_type_unknown` when the run's type cannot be read — pass `nodeType`: a key without the `jobs:read` scope, or a job that records no use-case type, no longer falls back to the Tighten Episode route, and nothing is posted. In the CLI, a key without `jobs:read` now needs `--type` on `nodaro edit continue-use-case`, and the error says so ("pass --type <node type>"; code `use_case_type_unknown`, kept under `--json`).

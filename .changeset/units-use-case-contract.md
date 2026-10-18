---
"@nodaro/shared": minor
---

`USE_CASE_NODE_TYPES`, `UseCaseNodeType` and `isUseCaseNodeType` are exported from `@nodaro/shared/nodes`: the use-case node types, each a route `POST /v1/<type>` (+ `/estimate`, `/continue`). The node-unit contract (`generated/unit-contracts.ts`) also carries the JSON pip kinds, the non-prompt inputs, the review holds and the published-app presentation of node units; the existing tables compose them, and their contents are unchanged.

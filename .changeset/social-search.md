---
"@nodaro/shared": minor
"@nodaro/sdk": minor
---

Social Search (Nodaro Cloud): `@nodaro/shared` adds the node's vocabulary, the `SocialPost` shape every platform's results share, the `SocialSearchParams` request, its credit ids and the rule for which posts a run passes on. `@nodaro/sdk` types `nodes.run("social-search", …)` and `nodes.runAndWait("social-search", …)` (resolving `SocialSearchJobOutput`) and re-exports the post and request types.

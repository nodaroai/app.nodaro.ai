---
"@nodaro/shared": minor
"@nodaro/sdk": minor
---

Workflow bundles now carry a `portability` note when they reference media another instance cannot fetch (a private host's own storage), and `workflows.import()` returns an `importReport` describing which media was copied onto the importing instance, which was unreachable, and which was skipped.

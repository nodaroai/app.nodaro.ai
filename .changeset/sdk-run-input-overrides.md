---
"@nodaro/sdk": minor
---

`workflows.run(id, { inputOverrides })`: per-node field overrides for one run, `{ [nodeId]: { field: value } }`. A workflow whose Apply EDL render is set to Preview is refused through the API (`preview_review_required`) unless the run sets it to Final with `{ [renderNodeId]: { quality: "final" } }`.

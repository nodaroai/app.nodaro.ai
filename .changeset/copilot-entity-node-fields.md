---
"@nodaro/shared": minor
---

Add `ENTITY_NODE_KINDS` and the entity-node field vocabulary — `ENTITY_DB_ID_FIELD`, `ENTITY_NAME_FIELD`, `ENTITY_TABLE`, `ENTITY_BUCKET_FIELDS`, `ENTITY_SCALAR_FIELDS`, `ENTITY_KIND_SCALAR_FIELDS`, `entityScalarFields()` and `entityHydrationColumns()`.

Which columns of a saved character / object / creature / location land on its canvas node, per kind. Four surfaces copy an entity row onto a node — the browser's load-time hydrator, its library picker, the server's run-time hydration, and the `@` mention picker — and they were four hand-written lists that drifted exactly as you would expect. This is the field NAMES only; merge behaviour stays with each caller, because a browser node and a server row disagree about nulls.

Public because the run contract needs it: an entity node's shape is part of what a workflow JSON means, so anything authoring one through the API has to know which fields carry the entity's media.

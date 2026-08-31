---
"@nodaro/shared": minor
"@nodaro/sdk": minor
---

Workflow export/import now carries the `@`-chips' entities. `collectAssetIds` harvests the entity ids bound in `ConnectedReference` chips (`generatedResults[].references[]`, `beats[].references[]`, anywhere else a `references` array sits in node data — and in the workflow's freeform `settings`, where an app can keep its own index of the same work), not only the four entity-node `*DbId` fields — so a graph that binds its entities through chips alone exports its characters, objects, creatures and locations instead of none of them, and imports with every chip, in the graph and in `settings` alike, re-pointed at the rows created under the importer.

`WorkflowImportReport` gains two optional fields: `assetIdMap` (bundled entity id → the row created for it, for chips a client holds outside the graph; present whenever the bundle carried `assets`, `{}` when nothing was created) and `assetsSkipped` (`{ kind, id, name, reason }[]` — entities storage quota left uncreated; the workflow still lands). A bundled entity's images are now copied into the importer's own storage even when they already sit on the same instance, because they are the exporter's bytes; the export's `portability.unreachableMedia` covers them too. The per-import copy cap applies per HALF — the graph's media and the bundled entities' each get the full budget, so neither can starve the other.

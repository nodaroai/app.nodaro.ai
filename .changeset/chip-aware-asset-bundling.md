---
"@nodaro/shared": minor
"@nodaro/sdk": minor
---

Workflow export/import now carries the `@`-chips' entities. `collectAssetIds` harvests the entity ids bound in `ConnectedReference` chips (`generatedResults[].references[]`, `beats[].references[]`, anywhere else a `references` array sits in node data), not only the four entity-node `*DbId` fields — so a graph that binds its entities through chips alone exports its characters, objects, creatures and locations instead of none of them, and imports with every chip re-pointed at the rows created under the importer.

`WorkflowImportReport` gains two optional fields: `assetIdMap` (bundled entity id → the row created for it, for chips a client holds outside the graph) and `assetsSkipped` (`{ kind, id, name, reason }[]` — entities storage quota left uncreated; the workflow still lands). A bundled entity's images are now copied into the importer's own storage even when they already sit on the same instance, because they are the exporter's bytes; the export's `portability.unreachableMedia` covers them too.

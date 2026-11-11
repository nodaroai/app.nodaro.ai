---
"@nodaro/sdk": minor
---

`presets.listFactoryGroups(nodeType)` (`GET /v1/node-presets/factory/groups`, public): the built-in catalog's categories in the order a picker shows them (shelf by shelf, then the design's order, then catalog order), each `{ group, shelf, count, previewUrl }` (`FactoryPresetGroupSummary`), a few KB where `listFactory()` is the whole catalog.

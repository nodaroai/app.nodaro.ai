---
"@nodaro/shared": minor
---

`MODEL_CATALOG` now carries `ltx-2.3-pro` and `ltx-2.3-fast` (modes, aspect ratios, resolutions, durations and the full pricing table). They were the last two `VIDEO_GEN_PROVIDERS` members outside the catalog, which meant `/v1/models`, MCP `list_models` and every catalog-driven normalizer skipped them and the frontend option menus were hand-spliced. A new totality test fails the build if another video provider is added without an entry.

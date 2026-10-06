---
"@nodaro/shared": minor
---

New structural exports: `LEGACY_SOURCE_HANDLE_ALIASES` / `LEGACY_TARGET_HANDLE_ALIASES` with `canonicalSourceHandle` / `canonicalTargetHandle` (the legacy handle id → current id tables the editor rewires saved graphs with, now also applied by the server to every MCP-written workflow), `DYNAMIC_HANDLE_NODE_TYPES` (node types whose handles are created at run time) and `IMAGE_PRODUCER_TYPES` (the image-producing node types, beside the existing video/audio producer sets).

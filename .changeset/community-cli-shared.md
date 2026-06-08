---
"@nodaro/shared": minor
"@nodaro/client": patch
"@nodaro/cli": minor
---

Centralize community listing types in `@nodaro/shared` (single source of truth, re-exported by `@nodaro/client`), and add a `community` command group to `@nodaro/cli` (`browse`, `get`, `favorites`, `clone`, `favorite`, `report`) mirroring the SDK resource. Publishing remains admin/editor-only and is intentionally not exposed.

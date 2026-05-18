---
"@nodaro/client": minor
"@nodaro/cli": minor
---

Added `client.locations` SDK resource and `nodaro locations` CLI subcommand group.

New SDK methods: `list`, `get`, `create`, `update`, `delete` (soft), `restore`, `generate`, `generateAsset`, `approveMainImage`, `recaption`.

New CLI subcommands: `list` (supports `--archived`), `get`, `create`, `update`, `delete`, `restore`, `generate` (supports `--watch`), `generate-asset`, `approve-main-image`, `recaption`.

**Breaking change:** `client.locations.delete(id)` now soft-deletes (returns `{ success: true, archived: true }`). Hard-delete is no longer exposed via SDK; use the archive gallery in the editor for permanent destruction.

Atmosphere motion clips + archive gallery + 5 environmental tabs ship in PR-2.

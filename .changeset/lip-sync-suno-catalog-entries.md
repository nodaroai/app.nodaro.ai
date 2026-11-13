---
"@nodaro/shared": minor
---

`MODEL_CATALOG` (`@nodaro/shared/model-catalog`) gains three Lip Sync models and three Suno versions. All were already accepted values of their routes and nodes; with an entry, a deployment's model allow list can name them, and `GET /v1/models` and MCP `list_models` list them.

- Lip Sync (kind `video`, mode `lip-sync`, no size lever): `latentsync` (LatentSync, ByteDance), priced at its existing `latentsync` row; `heygen-lipsync-precision` (HeyGen Lipsync Precision) and `lipsync-2-pro` (Lipsync 2 Pro, Sync Labs), each priced at its existing rows: the bare id (the 5-minute ceiling) and the `:15s`, `:30s`, `:60s`, `:120s` and `:300s` duration buckets.
- Suno (kind `audio`, mode `music`): `suno-v4_5plus`, `suno-v4_5all` and `suno-v4_5`, with `dataValue` `V4_5PLUS`, `V4_5ALL` and `V4_5`.

`MODEL_MAKERS` gains `heygen` (HeyGen).

`SUNO_VERSION_CREDIT_KEYS` (`@nodaro/shared/credits`) gains `V4_5PLUS` → `suno-v4_5plus`, `V4_5ALL` → `suno-v4_5all` and `V4_5` → `suno-v4_5`, so `sunoCreditType` prices a generate, cover or extend on one of them under its version's row instead of the operation's (`suno-generate`, `suno-cover`, `suno-extend`). The new rows carry the same price as the operation rows, so no run changes price. Only V4 still falls back to the operation's row.

---
"@nodaro/shared": minor
---

Grok joins Extend Video: **`grok-extend`**, a new `EXTEND_VIDEO_PROVIDERS` member with its own catalog entry (`MODEL_CATALOG["grok-extend"]`, made by xAI). It extends only a Grok Imagine video made from text or an image (`grok` / `grok-i2v`) on the same account, named by its task id, as the VEO and Runway extends are. It adds 6 or 10 seconds (default 6) at the source video's own resolution (480p or 720p), which is never a request lever; the result is Grok's video as it returns it. Its own catalog entry lets a deployment withhold or release it apart from Grok Imagine.

- New in `@nodaro/shared/models`: `GROK_EXTEND_PROVIDER`, `GrokExtendProvider` and `isGrokExtendProvider()`; `GROK_EXTEND_SOURCE_MODELS` and `isGrokExtendSourceModel()`, the Grok Imagine video models it can extend (`grok`, `grok-i2v`). Grok is not a `CatalogExtendProvider` (its resolution is its source's).
- New in `@nodaro/shared/credits`: `grokExtendSeconds(duration?)` (6 or 10, 6 when unset, any other length at the nearer of the two), `grokExtendCreditId(duration?, sourceResolution?)` (`grok-extend:<6|10>s:<480p|720p>`; any source resolution but `480p`, a source not known yet included, at the dearer 720p row), `grokExtendWiredSourceResolution(nodeId, nodes, edges)` (the source resolution a quote may use: `480p` only for a wired Grok Imagine video node set to 480p) and the `GrokExtendSourceResolution` type.
- `buildVideoCreditModelIdentifier` prices `grok-extend` at the dearer 720p row: a resolution handed to it is never a Grok extension's.
- `EXECUTION_DATA_KEYS` gains `outputKieTaskId`, the task an Extend or Upscale Video node's own run produced (its `kieTaskId` is the task it works on): run data, never undo, preset or template state.

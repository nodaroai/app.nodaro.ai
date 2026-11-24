---
"@nodaro/shared": minor
---

`listModels({ mode: "lip-sync" })` lists every model the Lip Sync node takes: the lip-sync-mode models, then the video models the node runs a portrait and a voice through (`LIP_SYNC_PROVIDERS`: the Seedance 2 family, MiniMax Hailuo 3, LTX 2.5 Fast), each once. Every other mode filter, and every model's own `modes`, is unchanged. `@nodaro/shared/models` exports `portraitVideoLipSyncModels()`: the Lip Sync models that make a new clip from a portrait and a voice.

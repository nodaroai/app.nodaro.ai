---
"@nodaro/shared": minor
---

Generate Music runs, and is priced, on the model it actually has.

- `DEFAULT_MUSIC_PROVIDER` (`"minimax"`) and `resolveMusicProvider(value)`: a node saved with a model it no longer offers (or the `"suno"` new nodes used to start on) runs the default model instead of failing validation.
- `MUSIC_CREDIT_ID` (`"generate-music"`) is the id every music run reserves on; the estimates and the node's price read it (the model id `"minimax"` is the MiniMax video model's price).
- `MUSIC_PROVIDER_LABELS` names each music model.

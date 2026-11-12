---
"@nodaro/shared": minor
---

`MODEL_CATALOG` (`@nodaro/shared/model-catalog`) gains `wan-animate-move` (Wan Animate Move) and `wan-animate-replace` (Wan Animate Replace), both Alibaba: kind `video`, mode `motion-transfer`, sizes 480p / 580p / 720p (`defaultResolution` 720p), priced at their existing `wan-animate-move`, `…:580p`, `…:720p` rows (and the same for Replace). They were already accepted `provider` values of Motion Transfer (`MOTION_TRANSFER_PROVIDERS`); with an entry, a deployment's model allow list can name them, and `GET /v1/models` and MCP `list_models` list them.

New: `motionTransferResolution(provider, resolution)` (`@nodaro/shared/credits`) — the size a Motion Transfer run is sent and charged at, with what moved (`adjustments`). A size the model does not have moves to its catalog `defaultResolution`: a Wan Animate request at 1080p runs, and is charged, as 720p. `buildMotionCreditModelIdentifier` prices through it, so `buildMotionCreditModelIdentifier("wan-animate-move", "1080p")` is now `wan-animate-move:720p` (it was the 480p row `wan-animate-move`). The Kling motion options are sent the size they name, as before, and their ids are unchanged. `normalizeNodeModelParams` applies the same rule to a Motion Transfer node's `resolution`.

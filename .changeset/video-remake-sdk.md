---
"@nodaro/sdk": minor
---

`client.videoRemake` (also `@nodaro/sdk/video-remake`) is Video Remake, formerly Nodaro Motion, calling `/v1/video-remake`: `run`, `estimate`, `styleChoice`, `fullQualityEstimate` and `fullQuality`, with its types named `VideoRemake*`. Its engines are `VideoRemakeEngine`: `"nodaro-prism"` (Nodaro Prism) and `"nodaro-pulse"` (Nodaro Pulse); `estimate()` answers the engine by its current id whichever id the server named, and a request still takes every earlier id (`VideoRemakeEngineLegacyId`, deprecated). `client.castSwap`, `CastSwapResource` and every `CastSwap*` type stay as deprecated aliases of the same resource and types.

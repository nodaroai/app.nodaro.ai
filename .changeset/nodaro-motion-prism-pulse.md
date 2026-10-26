---
"@nodaro/shared": minor
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Nodaro Motion's engines are renamed: **Nodaro Motion Prism** (`"motion-prism"`, was `"motion-pro"`) and **Nodaro Motion Pulse** (`"motion-pulse"`, was `"motion-lite"`). The earlier ids are still accepted wherever an engine is sent and are read as the new ones. The trend routes, the MCP tools and the SDK's `castSwap.estimate()` answer the new ids; until every environment runs the renamed Nodaro Motion engine, a job's `input_data.engine` (and its output's `engine`), and a quote read straight from `POST /v1/cast-swap/estimate`, may still name an earlier id.

`@nodaro/shared/models`: `NODARO_MOTION_ENGINES` is `["motion-prism", "motion-pulse"]` and `NODARO_MOTION_ENGINE_NAMES` names them Prism and Pulse. `NODARO_MOTION_ENGINE_NAMES` and `CAST_SWAP_ENGINE_OF_NODARO_MOTION` keep the earlier ids as keys, answering the engine each became. `castSwapEngineFrom` reads every id (current, earlier and internal), and `CAST_SWAP_ENGINE_IDS_ACCEPTED` lists them all. New: `NODARO_MOTION_LEGACY_ENGINES` / `NODARO_MOTION_LEGACY_ENGINE_OF` (each earlier id and the id it became), `NodaroMotionLegacyEngine`, and `nodaroMotionEngineFrom` (the public id any engine id names).

`@nodaro/sdk`: `CastSwapEngine` (and `TrendEngine`) is now `"motion-prism" | "motion-pulse"`. `CastSwapEngineLegacyId` adds `"motion-pro"` and `"motion-lite"`, still accepted in a request. `castSwap.estimate()` answers the quote's `engine` by the current id even when the server names an earlier one. TypeScript code that compares a response's `engine` with `"motion-pro"` or `"motion-lite"` must compare with the new ids.

`@nodaro/cli`: help text names Nodaro Motion Prism and Pulse.

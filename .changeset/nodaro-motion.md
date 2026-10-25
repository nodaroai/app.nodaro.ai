---
"@nodaro/shared": minor
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Cast Swap is now **Nodaro Motion**, with two engines: **Nodaro Motion Pro** (`"motion-pro"`) and **Nodaro Motion Lite** (`"motion-lite"`). Face masking is set by Nodaro per engine; a run no longer sets it.

`@nodaro/shared/models`: `NODARO_MOTION_ENGINES`, `NodaroMotionEngine`, `NODARO_MOTION_ENGINE_NAMES`, `CAST_SWAP_ENGINE_OF_NODARO_MOTION` / `NODARO_MOTION_ENGINE_OF_CAST_SWAP`, `nodaroMotionEngineOf`, `nodaroMotionEngineName`, `castSwapEngineFrom` (reads either id) and `CAST_SWAP_ENGINE_IDS_ACCEPTED`.

`@nodaro/sdk`: `CastSwapEngine` is now `"motion-pro" | "motion-lite"`, the id every response names (a trend's `engine`, a trend run's `engine`, a quote's `engine`), with `engineName` beside it on trends and trend runs. A request still takes the old ids (`CastSwapEngineLegacyId`, deprecated). `CastSwapParams.faceMasking` and `CastSwapFaceMasking` are deprecated: the server accepts and ignores them. TypeScript code that compares a response's `engine` with `"seedance-2-5"` or `"kling-4"` must compare with the new ids.

Quote and completion keys get neutral names: `breakdown.motion` (was `seedance` / `kling`), `breakdown.motionExpected` (was `seedanceExpected`), `breakdown.motionHd` (was `seedanceHd`), `breakdown.privacy` (was `masking`), `privacyCredits` (was `maskingCredits`) and the completion's `privacy` (was `faceMasking`). A Lite run's length fit is `motionLength` (`CastSwapMotionLength`; `klingLength` / `CastSwapKlingLength` still accepted, deprecated). `@nodaro/sdk` types the new names (`maskingCredits` stays, deprecated, for an older server).

`@nodaro/cli`: help text says Nodaro Motion; quotes list their parts by label, and its `--json` answers the neutral names (an older server's old ones renamed).

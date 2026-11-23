---
"@nodaro/shared": minor
"@nodaro/sdk": minor
---

Video Remake's Flash choices: Prism Flash (`engine: "nodaro-prism-flash"`) and Pulse Flash (`engine: "nodaro-pulse-flash"`), each its engine's run on the faster, lower-cost model of the same family at that model's own price, offered only where `styleChoice()` answers `flash` true for the engine (elsewhere a request naming one is refused 409 `flash_not_offered`). `@nodaro/shared/models` adds `VIDEO_REMAKE_FLASH_ENGINES`, `VIDEO_REMAKE_FLASH_ENGINE_NAMES`, `NODARO_MOTION_ENGINE_OF_FLASH`, `VIDEO_REMAKE_FLASH_RESOLUTIONS`, `videoRemakeFlashEngineOf`, `videoRemakeFlashEngineFrom` and `nodaroMotionEngineOfFlash`; the SDK adds `VideoRemakeFlashEngine` and `VideoRemakeEngineChoice` (taken by `run` / `estimate` and answered by `estimate()`), `VideoRemakeStyleChoice.flash`, and the error codes `flash_not_offered` and `flash_model_unsupported`; `castSwapEngineOfRun` reads a Flash choice as its engine's run.

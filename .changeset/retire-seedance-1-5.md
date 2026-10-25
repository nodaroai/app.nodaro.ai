---
"@nodaro/shared": minor
"@nodaro/prompts": patch
"@nodaro/cli": patch
---

`seedance` (Seedance 1.5 Pro) is retired: the provider stopped serving the model on 2026-10-25. It leaves the model catalog, `IMAGE_TO_VIDEO_PROVIDERS` / `TEXT_TO_VIDEO_PROVIDERS` / `VIDEO_GEN_PROVIDERS`, `OBJECT_MOTION_PROVIDERS` (where `seedance-2-mini` takes its place), the duration and audio tables, `PIPELINE_PINNABLE_VIDEO_MODELS` and the prompt-wizard descriptions. New `RETIRED_VIDEO_PROVIDERS` + `canonicalVideoProvider()` map a retired id to the model it now runs as (`seedance` → `seedance-2-mini`), and `resolveVideoProviderForMode` applies it, so a saved or sent `seedance` keeps working. The CLI's `objects motion --provider` offers `seedance-2-mini` instead of `seedance`. Code that names the literal `"seedance"` as one of those lists' member types (`ObjectMotionProvider`, `TextToVideoProvider`, `VideoGenProvider`, `PipelinePinnableVideoModel`) no longer compiles: pass it through `canonicalVideoProvider` or use `seedance-2-mini`.

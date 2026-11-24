---
"@nodaro/shared": minor
---

Video Upscale gains the `topaz-rhea` provider (Topaz's Rhea model): `VIDEO_UPSCALE_PROVIDERS` lists it, `TOPAZ_RHEA_VIDEO_UPSCALE_PROVIDER` and `isTopazRheaVideoUpscaleProvider` name it, and `MODEL_CATALOG` has its entry (`topaz-rhea`, 720p / 1080p / 4k, priced per second of the clip by target). The entry is `pickerHidden`: it is run by the platform and reachable by the API, and is not listed by `listModels` or offered by the editor. Required by the public API contract (the route's provider enum).

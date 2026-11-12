---
"@nodaro/shared": minor
---

Grok Imagine Video 1.5 (`grok-imagine-video-1.5`) gains frames and a 1080p tier.

- Catalog entry: features `end-frame`, `reference-image` and `keyframes` — the start frame is the exact first frame, an end frame the exact last frame (the same image as both makes a seamless loop), and the Image References are up to 4 in-between frames, never loose references. Still image-to-video only (no `reference-to-video`: in-between frames need the start frame), so it stays out of `GVP_SUPPORTED_PROVIDERS`. Resolutions `480p` (default) / `720p` / `1080p`, `unlistedResolutionRendersAs: "480p"`, `noSeed`. Pricing rows follow the new per-second ladder at all three resolutions, with no per-image part.
- `VIDEO_REF_LIMITS_BY_PROVIDER["grok-imagine-video-1.5"]` is `{ images: 4 }`, and the model joins `VIDEO_PROVIDERS_WITH_SEPARATE_FRAME_CHANNEL`. `RESOLUTION_DURATION_PRICING` adds `1080p`; `buildVideoCreditModelIdentifier` bills the resolution through the same normalizer the runner sends, so `"1080P"` bills the 1080p row and anything unknown the 480p row.
- New exports `GROK_VIDEO_15_PROVIDER`, `isGrokVideo15Provider()`, `GROK_VIDEO_15_DEFAULT_RESOLUTION`, `normalizeGrokVideo15Resolution()`, `GROK_VIDEO_15_MAX_MIDDLE_FRAMES`, `grokVideo15MiddleFrameSlots()` (one in-between frame per whole second inside the clip, at most 4) and `videoKeyframesMiddleCap()`.
- New `videoProviderTakesLoneEndFrame()` (Kling 4.0 Keyframes and Gemini Omni Flash 1.2 take an end frame alone) and `videoProviderRefsReplaceStartFrame()` (whether wired reference images can stand in for a missing start frame). Both answer exactly as before for every other model.
- `PRICING_DEFAULT_RESOLUTION["grok-imagine-video-1.5"]` is `480p`: a request that names no resolution is judged (free tier), filled (`pricedVideoSelection`) and billed at 480p.
- The quality map's `high` rung for this model is `1080p`.

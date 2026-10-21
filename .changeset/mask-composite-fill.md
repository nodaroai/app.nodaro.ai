---
"@nodaro/shared": minor
"@nodaro/sdk": patch
"@nodaro/cli": minor
---

Mask Composite takes `fill`: `"video"` (the default — the foreground, as before), `"pixelate"` (the background itself in blocks of `pixelSizePct` % of the frame width, 0.2–10, default 1.25) or `"blur"` (the background blurred, gaussian sigma `blurStrengthPct` % of the frame width, 0.1–5, default 2) — both relative, so a setting looks the same at any resolution. Pixelate and blur take no foreground: `MaskCompositeRequest.foregroundUrl` is now optional (required for the video fill), the result follows and is priced on the background, and the result always carries the background's sound (`audioSource` is ignored for these fills). `@nodaro/shared` adds `MASK_COMPOSITE_FILLS`, the `PIXEL_SIZE_PCT_*` / `BLUR_STRENGTH_PCT_*` bounds, the new defaults and settings fields, and `maskCompositeFillOf` / `maskCompositeUsesForeground` / `maskCompositeLeadHandle` / `maskCompositeEffectiveAudioSource`. `nodaro media mask-composite` gains `--fill`, `--pixel-size-pct` and `--blur-strength-pct`; with `--fill pixelate|blur` it takes `<backgroundUrl> <maskUrl>`.

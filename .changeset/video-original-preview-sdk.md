---
"@nodaro/sdk": minor
---

`VideoJobOutput`: the `output_data` of a completed video job. `videoUrl` is always browser-playable; when the provider's file is one the browser-safe step would change (not H.264 yuv420p, e.g. HEVC 10-bit or HDR), that file is kept untouched as `originalVideoUrl` and `videoUrl` is its 8-bit H.264 preview (an HDR original's tone-mapped to SDR). `videoPreviewUnavailable: true` means the preview could not be made and `videoUrl` is the original itself. Watermarked runs keep no original.

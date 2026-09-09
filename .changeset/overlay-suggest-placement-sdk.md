---
"@nodaro/sdk": minor
---

Add `media.suggestOverlayPlacement()` — ask a vision model where one overlay layer should sit on a base image (`POST /v1/image-overlay/suggest-placement`). Answers synchronously with `anchor` / `x` / `y` / `width` in `media.imageOverlay()`'s own percent units plus a one-sentence reason, so the box drops straight onto a layer. The `OverlayPlacement` type is exported too.

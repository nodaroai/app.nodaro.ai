---
"@nodaro/sdk": minor
---

Video Remake's Face chip: a person role takes `face?: "new" | "original"` (`VideoRemakePersonRole.face`; from the picture, the default, or from the video, which keeps the person's own face), and `client.videoRemake.styleChoice()` answers `roleFace?: boolean`, whether this deployment's engine keeps faces (absent from an older server: treat it as `false`; elsewhere `face: "original"` is refused 409 `engine_unsupported`). A trend slot's chips (`TrendChips`, `TrendChipKey`) take `face` too, listed only on a trend that offers it where the engine keeps faces.

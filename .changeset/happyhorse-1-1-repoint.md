---
"@nodaro/shared": minor
"@nodaro/prompts": patch
---

HappyHorse 1.1: the `happyhorse` / `happyhorse-i2v` / `happyhorse-ref2v` ids now target KIE's `happyhorse-1-1/*` endpoints (1.0 was delisted; identical parameter surface, so existing workflows keep working). Catalog gains the model's full 9-ratio aspect set (adds `4:5`, `5:4`, `21:9`, `9:21` for T2V/Ref2V) and per-second pricing tiers (`<id>:<N>s:<720p|1080p>`, N = 3–15) in `DURATION_PRICED_PROVIDERS` / `VIDEO_DURATION_TIERS` / `RESOLUTION_DURATION_PRICING`. Prompt-wizard capability blurbs updated accordingly.

---
"@nodaro/shared": minor
"@nodaro/prompts": patch
---

**@nodaro/shared**

- Seedance 2.5 (`seedance-2-5`) gains the **1080p** resolution tier (KIE "Seedance 2.5 now supports 1080P", probe-verified 2026-08-17 — 4k/2k/1440p are still rejected). `MODEL_CATALOG` `resolutions` is now `["480p", "720p", "1080p"]`, catalog pricing rows carry the 8s/30s 1080p anchors (2280/8550 no-ref, 1370 with-ref at 8s), and the `QUALITY_MAP` `high` rung maps to `1080p` (was `720p`). Everything derived from the catalog — credit identifier clamping, `/v1/nodes` `providerResolutions`, GVP/EVP tier clamps, resolution dropdowns — picks the new tier up automatically.

**@nodaro/prompts**

- Seedance 2.5 doctrine and wizard capability strings updated for the 1080p tier (routing advice now sends only 4K jobs to `seedance-2`).

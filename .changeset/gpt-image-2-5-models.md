---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

Add GPT Image 2.5 Flare and Sunburst (text-to-image and image-to-image).

Four new model ids — `gpt-image-2-5-flare`, `gpt-image-2-5-flare-i2i`,
`gpt-image-2-5-sunburst`, `gpt-image-2-5-sunburst-i2i` — with catalog capability
sheets, pricing rows (15 / 25 / 40 credits at 1K / 2K / 4K), the t2i→i2i
auto-route siblings, a 20000-char prompt ceiling and a 16-image reference cap.

The image aspect-ratio vocabulary gains `27:16`, `16:27`, `9:8` and `8:9`, so
`normalizeModelInput` now snaps to (rather than rejects) the widest GPT ratio
set. Existing models are unaffected — the per-model gate is the catalog snap,
not this vocabulary bound.

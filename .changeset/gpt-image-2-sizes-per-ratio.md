---
"@nodaro/shared": patch
---

GPT Image 2's two size rules are now catalog data: `gpt-image-2` and `gpt-image-2-i2i` carry `resolutionsByAspectRatio: { auto: ["1K"], "1:1": ["1K", "2K"] }` (`auto` renders 1K only, 1:1 never 4K). `normalizeModelInput` applies them through the same per-ratio step as every other model, so the size it sends and the price id it builds are unchanged; only the wording of the 1:1 adjustment changes, to `GPT Image 2 only renders 1K or 2K at the "1:1" aspect ratio.` `resolutionsAtAspectRatio` and `resolutionAtAspectRatio` now follow the rules too, so a size menu offers 1K only at `auto` and 1K or 2K at 1:1, and a price read through `resolutionAtAspectRatio` matches the size the run renders.

---
"@nodaro/shared": patch
---

GPT Image 2 (`gpt-image-2`, `gpt-image-2-i2i`) renders every aspect ratio it offers at 1K, 2K and 4K, `auto` and 1:1 included. `normalizeModelInput` no longer moves a 2K or 4K request at `auto` to 1K, or a 4K request at 1:1 to 2K, and reports no adjustment for either: the size asked is the size sent, and the price id is that size's (`gpt-image-2:2K`, `gpt-image-2:4K`). The two entries carry no `resolutionsByAspectRatio`, so `resolutionsAtAspectRatio` offers all three sizes at every ratio and `resolutionAtAspectRatio` returns the size asked.

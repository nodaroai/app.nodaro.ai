---
"@nodaro/shared": minor
---

GPT Image 2.5 (Flare and Sunburst, text-to-image and edit) renders the 27:16, 16:27, 9:8 and 8:9 aspect ratios at 1K only. A catalog entry can now say which sizes a ratio renders (`resolutionsByAspectRatio`), and the four GPT Image 2.5 entries declare 1K for those four ratios. `normalizeModelInput` moves a 2K or 4K request at such a ratio to 1K and reports the adjustment, before the request is priced, so `resolveNormalizedImageGen` prices the size that renders. Two helpers read the rule: `resolutionsAtAspectRatio(modelId, aspectRatio)` lists the sizes a menu should offer at a ratio, and `resolutionAtAspectRatio(modelId, aspectRatio, resolution)` gives the size a request renders at.

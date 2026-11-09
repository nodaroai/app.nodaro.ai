---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

GPT Image 2.6 joins the catalog: `gpt-image-2-6-flare`, `gpt-image-2-6-sunburst` and `gpt-image-2-6-economy`, each with an `-i2i` sibling. Flare and Sunburst take an `auto`, `low`, `medium`, `high`, `xhigh` or `max` quality at 1K, 2K or 4K, and an edit is priced by how many images it is given. Economy is a flat price at 1K.

Adds the `background` lever (`IMAGE_BACKGROUND_VALUES`, `ImageBackground`) on GPT Image 2, 2.5 and 2.6: `backgrounds` and `transparentResolution` on catalog entries, `background` through `normalizeModelInput` and `resolveNormalizedImageGen`, and `backgroundOptionsByKind`. `"low"` joins `IMAGE_QUALITY_VALUES`.

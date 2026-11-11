---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

Seedream 5.5 joins the catalog: `seedream-5-5` (text to image) and `seedream-5-5-i2i` (image to image, up to 10 input images, run by itself when images are added). Sizes `1K`, `1.5K` and `2K` (`defaultResolution` 2K), a `background` of `auto`, `opaque` or `transparent`, and `png` or `jpeg` (`outputFormats`). It is priced by size and, on an edit, by each input image.

`1.5K` joins `IMAGE_RESOLUTION_VALUES` (and the new `IMAGE_K_RESOLUTION_VALUES`); on any other model `normalizeModelInput` moves it to a size that model lists. New: `isPricedPerInputImage`, `isPricedPerInputImageEdit`, `pricedSentImages` and `pricedEstimatedImages`, which count the input images of every model priced per input image (GPT Image 2.6 Flare and Sunburst, Seedream 5.5) the same way; the `SEEDREAM_5_5_*` constants; and `MIN_IMAGE_PROMPT_CHARS_BY_PROVIDER` / `getMinImagePromptChars`, the shortest prompt a model takes (5 characters on Seedream 5.5).

A catalog entry may declare `strictAspectRatios: true`: its provider refuses an aspect ratio the model does not list (read from the provider's schema, not inferred from the list). Only Seedream 5.5's two ids declare it.

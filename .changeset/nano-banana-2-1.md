---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

Add Nano Banana 2.1 (`nano-banana-2-1`), Google's high-efficiency image model for generation and editing, and make it the default in place of Nano Banana 2. It is one id for text-to-image and image-to-image (`IMAGE_GEN_PROVIDERS` and `IMAGE_I2I_PROVIDERS`), takes up to 10 reference images and a 20,000-character prompt, and offers fifteen aspect ratios (`auto`, the standard set and the 4:1 / 1:4 / 8:1 / 1:8 banners) at 1K, 2K or 4K. The `MODEL_CATALOG` entry lists 10 / 20 / 30 credits for 1K / 2K / 4K (`nano-banana-2-1`, `nano-banana-2-1:2K`, `nano-banana-2-1:4K`).

Nano Banana 2 stays available everywhere a model id is accepted. In the pipeline image pin, 2.1 replaces it: `PIPELINE_PINNABLE_IMAGE_MODELS` offers `nano-banana-2-1` and no longer `nano-banana-2`, and the pipeline config schema validates against the new `PIPELINE_ACCEPTED_IMAGE_MODELS` (the offered pins plus `PIPELINE_LEGACY_PINNED_IMAGE_MODELS`), so a pipeline already pinned to Nano Banana 2 keeps its pin.

`@nodaro/prompts`: the Cast & Consistency factory presets (Character Reference Grid, Cast Mega Grid, Cast Scene) now use `nano-banana-2-1`, and the prompt wizard describes the new model.

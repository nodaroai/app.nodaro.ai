---
"@nodaro/shared": minor
"@nodaro/prompts": patch
---

Add Seedream 5 Flash, Bytedance's fast, low-cost Seedream 5, as a text-to-image id (`seedream-5-flash`, in `IMAGE_GEN_PROVIDERS`) and an image-to-image id (`seedream-5-flash-i2i`, in `IMAGE_I2I_PROVIDERS`); a text-to-image request with reference images routes to the i2i id (`T2I_TO_I2I_VARIANT`). It takes up to 10 input images and a 5,000-character prompt, and offers the eight Seedream aspect ratios at 1K or 2K. Unlike the other Seedream 5 models its lever is resolution, not quality. The `MODEL_CATALOG` entries list a flat 10 credits per image at either size. The prompt wizard describes both ids.

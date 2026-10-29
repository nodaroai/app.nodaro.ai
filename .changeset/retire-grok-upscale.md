---
"@nodaro/shared": minor
"@nodaro/sdk": patch
---

`grok-upscale` is retired: it never upscaled an image. The provider endpoint it was wired to upscales a Grok *video* task, and the provider offers no Grok image upscale, so every run was refused upstream. It leaves the model catalog, `IMAGE_EDIT_PROVIDERS` and `TASK_CHAINED_EDIT_PROVIDER_IDS` (now `grok-2-edit` and `grok-2-segment` only); `POST /v1/edit-image` answers the id with a 400 `validation_error` naming the replacement (`recraft-upscale` or `topaz-image-upscale`). The SDK's `EditImageParams` task form takes the two remaining Grok 2 ops.

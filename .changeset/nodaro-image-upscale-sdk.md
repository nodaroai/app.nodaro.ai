---
"@nodaro/sdk": minor
---

`EditImageParams` takes `provider: "nodaro-image-upscale"` (Nodaro Image Upscale) and `upscaleFactor` is now `UpscaleFactor` — "1", "2" or "4" on `topaz-image-upscale`, and "1", "2", "4" or "8" on `nodaro-image-upscale` (a factor the model does not take answers `400 validation_error`). Nodaro Image Upscale is priced by its output's size and refuses an output past 67,108,864 pixels or 16,384 pixels on a side with `400 image_too_large`, before anything is charged.

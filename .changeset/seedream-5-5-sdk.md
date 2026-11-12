---
"@nodaro/sdk": patch
---

`ImageResolution` takes `1.5K` (Seedream 5.5's middle size). The `background` notes on `GenerateImageParams` and `ImageToImageParams` say where a transparent background renders at 1K only (GPT Image) and where at any size (Seedream 5.5), and `ImageToImageParams.referenceImageUrls` names each model's own limit (15 on GPT Image 2.6, 9 on Seedream 5.5).

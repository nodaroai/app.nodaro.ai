---
"@nodaro/shared": minor
"@nodaro/sdk": patch
---

GPT Image 2.6's own `auto` aspect ratio renders a portrait photo square, so the six GPT Image 2.6 catalog entries now carry `autoAspectFromSourceImage: true`: `auto` stays in their `aspectRatios` (every menu still offers it), and `autoAspectNeedsSourceImage` answers true for it, so `"auto"` with a photo is resolved by `normalizeModelInput` to the 2.6 ratio nearest the photo, as on a model without a native auto. With no photo, or one whose size is unknown, the model's own `auto` is kept as before. GPT Image 2.5 keeps its native `auto`. The SDK's `aspectRatio` doc comment on image-to-image says so.

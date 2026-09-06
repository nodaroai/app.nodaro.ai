---
"@nodaro/sdk": minor
---

`StructuredReferenceParams.describedReferences` — up to 10 `{ name, description }` entries for a subject you can name and describe but have no media for, on `generate-image`, `generate-video` and `text-to-video`. They attach nothing and claim no `@image_N` seat; each reaches the model as a `<Name> — <description>.` line, correlated with the prose BY NAME. `GenerateVideoParams` / `TextToVideoParams` also gain `referenceVideoCaptions` / `referenceAudioCaptions`, index-aligned with the rail url arrays. `DescribedReference` is re-exported from the SDK.

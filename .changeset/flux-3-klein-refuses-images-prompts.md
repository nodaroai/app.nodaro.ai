---
"@nodaro/prompts": patch
---

`assembleImageInput` / `buildImagePrompt` no longer trim the structured references (`connectedReferences`: prompt-mention images, a node's attached images) of a model that refuses images over its limit (`refusesImagesOverLimit` in `@nodaro/shared`: FLUX 3 Klein). Every reference the run attaches is in `referenceImageUrls`, so a caller that counts them refuses the run at the number it would really send: 11 FLUX 3 Klein mentions are refused at 11, instead of running as 10 with the 11th mention left in the prompt as plain text. A character's unmentioned looks still attach nothing. Every other model keeps its trim to its reference limit.

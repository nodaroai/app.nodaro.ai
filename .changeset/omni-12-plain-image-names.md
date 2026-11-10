---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

Gemini Omni Flash 1.2 names its images in plain words. `VideoReferenceSyntax` and the catalog's `referenceSyntax` gain `"image N"`, declared on `gemini-omni-flash-1-2`. When its frames share the image list with reference images, the prompt now reads "image 3 is the opening (first) frame of the video. image 1 and image 2 are references for the subject; they are not frames." instead of the `@image_N` sentences, which in a test run opened the clip on a reference image rather than the start frame.

`@nodaro/prompts`: `imageBindingFor` accepts `"image N"`, and the `ImageBinding` it returns also carries `frames(first, last)` and `identities(first, last)`, so `placeFramesAfterReferences` writes every sentence in the provider's own syntax. New type `ImageReferenceSyntax`.

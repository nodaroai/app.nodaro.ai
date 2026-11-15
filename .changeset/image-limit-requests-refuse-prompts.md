---
"@nodaro/prompts": minor
---

`assembleImageInput` and `buildImagePrompt` take `runKind` (`"request"` or `"workflow"`, the default). On a request, a model with a request image limit of its own (Seedream 5.5, GPT Image 2.6 Flare and Sunburst, MiniMax H3 Image, FLUX 3 Klein) has none of its structured references (`connectedReferences`: prompt-mention images, a node's attached images) trimmed, so a caller that counts `referenceImageUrls` refuses the request at the number it names: 12 Seedream 5.5 mentions come back as 12, not 10. A workflow run keeps the trim on every model except FLUX 3 Klein, as before, and every other model is trimmed to its reference limit on both.

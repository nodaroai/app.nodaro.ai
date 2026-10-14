---
"@nodaro/prompts": patch
---

`buildImagePrompt`: an empty `connectedReferences` list with ancestor images takes the flat path, so a photo that reaches the node only through a passthrough node is sent and its `{image:N}` binds, instead of being dropped and rendering as its label. Every other input assembles as before.

---
"@nodaro/prompts": patch
---

`buildImagePrompt`: with no connected references (an empty `connectedReferences` list, or only `describedReferences` beside flat `referenceImageUrls`), `{image:N}` now counts the flat URLs, as it does without a connected list. Before, the photo was sent at slot 1 while `{image:1:person}` rendered as `person`. With any connected reference present, `{image:N}` keeps counting the connected entries.

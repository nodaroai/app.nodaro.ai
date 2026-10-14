---
"@nodaro/shared": minor
---

`nodeAspectRatio(nodeType, aspectRatio)` and `PHOTO_AUTO_ASPECT_NODE_TYPES`: on Generate Image and Modify Image an unset aspect ratio is `"auto"`, the value their dropdown shows for it. Both engines now send it, instead of no ratio (which let the model's own default reframe the image).

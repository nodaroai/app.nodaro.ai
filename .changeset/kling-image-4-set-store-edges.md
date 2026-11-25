---
"@nodaro/shared": patch
---

`manualReferenceImages` reads the pictures attached to an image node by hand (`{ id, url }` entries, or the older single `referenceImageUrl`), and the Kling Image 4.0 estimate (`klingImage4EstimatedItems`) now counts them through it, so an uploaded reference is no longer left out of the estimate.

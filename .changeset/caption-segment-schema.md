---
"@nodaro/shared": minor
---

The add-captions segment schema is now exported: `captionSegmentInputSchema`, `captionInputSchema`, `captionFontWeightSchema`, `nonBlankCaptionText`, `CAPTION_SEGMENT_SCHEMA_KEYS`, the `CaptionSegmentInput` type and `findSegmentOverlap`. They are the same definitions the Add Captions route has always validated against, moved so the route and both workflow engines read one copy. Additive.

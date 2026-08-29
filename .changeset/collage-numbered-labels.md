---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Image collage gains storyboard badges — optional per-image sequence numbers and captions.

`@nodaro/sdk`: `media.imageCollage(input)` accepts two new optional fields. `numbered` (boolean) stamps a 1-based sequence badge at each image's top-right, in `imageUrls` order — storyboard mode. `imageLabels` (`Array<string | null>`, index-aligned with `imageUrls`; `null`/`""`/omitted = no caption for that image) captions images after the number, rendered as `3 · Close-up`. Both are optional and default off; badges are an overlay only and never change the layout, the output size, or the credit cost.

`@nodaro/cli`: `nodaro media collage` gains `--numbered` (stamp the sequence badges) and a repeatable `--label <text>` flag, index-aligned with the image arguments in order (pass `""` to skip one image). More `--label` values than images, or any label over 80 characters, is a hard error.

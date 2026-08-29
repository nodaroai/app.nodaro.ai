---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Image collage storyboard badges can be placed in either top corner — default is now **top-left**.

`@nodaro/sdk`: `media.imageCollage(input)` accepts `badgePosition?: "top-left" | "top-right"`. The number/label badges default to the image's top-left corner (the storyboard convention — the shot number leads the frame in reading order); `"top-right"` keeps them clear of a subject composed left-of-centre. Existing callers that relied on the previous top-right placement should pass `badgePosition: "top-right"` explicitly.

`@nodaro/cli`: `nodaro media collage` gains `--badge-position <top-left|top-right>` (default `top-left`); any other value is a hard error.

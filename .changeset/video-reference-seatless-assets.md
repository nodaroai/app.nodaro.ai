---
"@nodaro/prompts": minor
---

`resolveVideoReferenceCore` takes `assetsTakeNoSeat`, for a video model whose image references are its frames (Grok Imagine Video 1.5, Kling 4.0 Keyframes): no wired character or extra attaches a URL or is numbered as an `@image_N`. A wired character gives its name and description in both reference formats, a mention of it or a `{ref:<id>}` naming it reads as its name, and an extra that is not a character adds nothing. Without the option every output is unchanged.

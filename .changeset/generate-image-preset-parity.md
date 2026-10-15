---
"@nodaro/sdk": minor
"@nodaro/cli": patch
---

`GenerateImageParams` types `presetId` and `presetVariables`: `POST /v1/generate-image` now applies a node preset exactly as the editor does (prompt and pre/post text, placeholder defaults, style, negative prompt, levers), so `nodes.run("generate-image", { presetId })` sends the editor's request. The CLI's `nodes run` help shows a preset example.

---
"@nodaro/sdk": minor
---

`nodes.quote(type, params)` prices a run before it starts (`POST /v1/quote`): the credits it reserves, what it is expected to cost, and why — typed for `text-to-video`, `generate-video` and `video-to-video`. `nodes.run("video-to-video", VideoToVideoParams)` is typed (Seedance 2.5 edits included), and every typed video overload takes `{ idempotencyKey }`. `GenerateMaskRequest` / `GenerateMaskOutput` are exported again.

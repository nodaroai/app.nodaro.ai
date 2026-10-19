---
"@nodaro/shared": minor
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Generate Mask over the SDK and CLI: `client.media.generateMask({ imageUrl, prompt, threshold? })` (`POST /v1/generate-mask`, Grounded SAM) and `nodaro media generate-mask <imageUrl> <prompt> [--threshold <n>] [--watch]` select a subject described in plain text in an image and return a job whose output carries `maskUrl` (a black-and-white mask PNG, white = the subject) and `imageUrl` (the source image, passed through unchanged). `@nodaro/shared/media` adds the wire contract — `GenerateMaskRequest`, `GenerateMaskOutput` and `GENERATE_MASK_LIMITS` (prompt 1–500 characters, threshold 0–1, default 0.3) — which the route now validates against; the SDK re-exports both types.

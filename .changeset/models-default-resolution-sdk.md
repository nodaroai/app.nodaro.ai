---
"@nodaro/sdk": minor
---

`ModelSummary` (from `client.models.list()`, `GET /v1/models`) types `defaultResolution?: string`: the size a request that names no `resolution` lands on, where the model declares one (`"1K"` on FLUX 3 Klein, `"2K"` on Seedream 5.5 and MiniMax H3 Image, `"720p"` on PixVerse V6 Max). Absent on every other model and on an older server.

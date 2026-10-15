---
"@nodaro/sdk": minor
---

Generation sessions inside projects: `client.sessions` — `create`, `list` (with `itemCount` and `previewUrls`), `get`, `update` (title, archive), `delete`, the session feed `items`, `importItems` (your own jobs, as links, all-or-nothing) and `removeItem` (the link only). Send `sessionId` on a generation request to file its job in a session; `sessionId` and `origin` are typed on `GenerateImageParams`, `GenerateVideoParams` and `TextToVideoParams` (`GenerationSessionParams`), `GenerateImageParams` also types `promptPrefix` / `promptSuffix`, and `Job` carries `session_id`.

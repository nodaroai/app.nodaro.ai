---
"@nodaro/shared": minor
---

A new Extend Video provider: **Gemini Omni Flash 1.2 Extend** (`gemini-omni-flash-1-2-extend`), made by Google. It continues a 16:9 or 9:16 video from its last 10 seconds and joins the new seconds onto the original clip.

- Catalog entry `gemini-omni-flash-1-2-extend` (mode `extend`): 3–10 s added (default 8), `360p` / `720p` / `1080p` / `4k`. It joins `EXTEND_VIDEO_PROVIDERS`, `TailExtendProvider` / `CatalogExtendProvider` (no reference images, no sound switch: its sound is always on) and `MAX_VIDEO_PROMPT_CHARS_BY_PROVIDER` (20,000).
- A run is charged per second of video sent and added, and is priced under ONE id that names both lengths and the resolution: `gemini-omni-flash-1-2-extend:<resolution>:sent-<S>s:added-<A>s`. New `geminiOmniExtendQuoteCreditId({ sourcePictureSec, duration, resolution })` builds it (the seconds sent counted as the charge counts them; no known source: the whole 10 s window), `parseGeminiOmniExtendQuoteCreditId()` reads it back, with the type `GeminiOmniExtendQuoteCreditIdParts`. `GET /v1/credits/model-cost` and `POST /v1/credits/model-costs` answer it with exactly what the run is charged. `tailExtendCreditId()` / `buildVideoCreditModelIdentifier()` name the whole-window id for this provider, and its catalog figures are such ids.

---
"@nodaro/shared": minor
---

New `structuredOutputMode: "responses-json-schema"` — KIE's `codex/v1/responses` endpoint natively enforces `text.format` JSON schemas (live-verified 2026-07-14, text and vision inputs). Applied to `gpt-5.4`, `gpt-5.5`, and the GPT-5.6 family (`gpt-5.6-luna` / `gpt-5.6-terra` / `gpt-5.6-sol`), which therefore now appear in `STRUCTURED_VISION_MODELS` (guaranteed-structured vision models, e.g. the describe-to-picker model gate).

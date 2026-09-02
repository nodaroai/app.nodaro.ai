---
"@nodaro/shared": minor
---

New `SUNO_HARD_CEILING` (30000) — the absolute Zod bound for Suno text fields on the `/v1/suno/*` routes. The per-version caps (`getMaxSunoPromptChars` / `getMaxSunoStyleChars`) still decide what reaches the provider; the routes clamp to them. Previously the routes bounded these fields at `SUNO_TEXT_MAX` (5000), so a programmatically-set prompt was hard-rejected with a 400 before the clamp could trim it. Deliberately separate from `PROMPT_HARD_CEILING`, which is an image/video budget with its own drift guard.

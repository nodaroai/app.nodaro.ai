---
"@nodaro/shared": patch
---

Suno's non-custom prompt cap is 3000, not 500. `getMaxSunoPromptChars(model, false)` returned 500 — six times under the provider's documented limit — and the suno route truncates rather than rejects, so a 950-character score brief reached Suno cut to exactly 500 characters mid-word, with nothing in the job record to show it.

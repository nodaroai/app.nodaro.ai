---
"@nodaro/sdk": minor
---

`CastSwapParams` takes `prePrompt?: string` (`POST /v1/cast-swap` and `/v1/cast-swap/estimate`): your own words placed at the start of the prompt, before the role instructions, at most 4,000 characters. Mention a role as `{role:N}`, as in `postPrompt`; the same refusals apply (`invalid_role_mention`, `raw_reference_token`). Like `postPrompt`, a `prePrompt` alone is enough to run (no role needs images).

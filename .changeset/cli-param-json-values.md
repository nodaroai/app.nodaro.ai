---
"@nodaro/cli": minor
---

`--param` / `--input` now accept JSON values: a value starting with `[`, `{`, or `"` is parsed as JSON (e.g. `--param 'targetPickers=["person"]'` sends a real array; `--param 'seed="123"'` forces a string). Bracket-leading values that are not valid JSON still pass through as plain strings, so prompts like `[cinematic] a leopard` are unaffected. Previously array/object parameters required `--params-file`.

---
"@nodaro/prompts": patch
---

Image prompts: an `{image:N}` reference token with no image at its position now falls back to its label (`{image:1:person}` → `person`) and a bare `{image:N}` is dropped, instead of reaching the model as raw text — the rule video prompts already follow, through the same shared helper. Every token that binds renders exactly as before.

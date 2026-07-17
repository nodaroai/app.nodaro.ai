---
"@nodaro/shared": patch
---

`getLlmModel` now resolves dash-form model aliases (e.g. `claude-sonnet-4-6`) to their canonical dot-form ids (`claude-sonnet-4.6`), and accepts provider slugs as historical aliases. Fixes runtime `Unknown LLM model` for callers holding dash-form ids from wire contracts (`PIPELINE_PINNABLE_SCRIPT_LLMS`, persisted pipeline configs, plugin model pins).

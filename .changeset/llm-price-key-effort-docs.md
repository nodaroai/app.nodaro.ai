---
"@nodaro/sdk": patch
"@nodaro/cli": patch
---

The metered LLM price key named in `credits.modelCosts` (sdk) and `nodaro models cost` (cli) can also carry the effort a call sends — `<feature>:<model>[:direct | :effort-<level>]` — on a model whose price depends on it.

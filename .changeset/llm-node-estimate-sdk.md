---
"@nodaro/sdk": minor
---

`NodeDescriptor.estimate?: true` (`nodes.list()` / `nodes.get()`): a metered LLM node's `creditCost` is its default model's typical-call estimate — charged its actual usage after the run, so show it `~N`. Absent for a fixed price.

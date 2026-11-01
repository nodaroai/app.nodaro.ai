---
"@nodaro/shared": minor
---

Every model names its product line (`series`). `ModelCatalogEntry.series` is now required, and `LlmModelDef` gains a required `series` ("Claude", "GPT", "Gemini", "Grok", "Kimi", "DeepSeek"), so a model can be filtered by its line. A catalog entry or LLM model you build yourself must now set it. The two AI Audit catalog rows carry the series "AI Audit"; the Models tab still lists only models that create a node.

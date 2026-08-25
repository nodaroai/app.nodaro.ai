---
"@nodaro/prompts": patch
---

Add a content-free contract guard test: the package source must not read
`process.env`. Deployment-gated prompt content (fixed clauses, forced vocal
gender) belongs in a deployment's registered `PromptPolicy`, never in this
published package.

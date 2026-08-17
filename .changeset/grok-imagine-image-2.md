---
"@nodaro/shared": minor
"@nodaro/prompts": patch
---

**@nodaro/shared**

- New Grok Imagine Image 2.0 model ids in `MODEL_CATALOG` and the provider enums: `grok-2` (t2i, in `IMAGE_GEN_PROVIDERS`), `grok-2-edit` and `grok-2-segment` (in `IMAGE_EDIT_PROVIDERS`). The edit and segment ops reference a prior grok-2 generation's KIE task id (the generation job's `kieTaskId` output) instead of an image URL; `grok-2-edit` optionally takes 1-based segment `maskIndexes` for region-targeted edits, and `grok-2-segment` is free.
- New export `TASK_CHAINED_EDIT_PROVIDERS` — the set of edit providers that take a prior Grok task id instead of an image URL (`grok-upscale`, `grok-2-edit`, `grok-2-segment`); single source of truth for the route/worker/MCP taskId-vs-imageUrl branching.

**@nodaro/prompts**

- Prompt-wizard image capabilities gain a `grok-2` entry.

---
"@nodaro/shared": minor
---

Claude Haiku 5.5 replaces Claude Haiku 4.5 as the film pipeline's offered Haiku Script LLM: `PIPELINE_PINNABLE_SCRIPT_LLMS` now lists `claude-haiku-5-5`. A saved pipeline pinned to `claude-haiku-4-5` keeps its pin. New exports: `PIPELINE_LEGACY_PINNED_SCRIPT_LLMS` (still honoured, no longer offered) and `PIPELINE_ACCEPTED_SCRIPT_LLMS` (both lists, what `PipelineConfigSchema` validates `script_llm` against).

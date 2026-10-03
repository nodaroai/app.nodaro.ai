---
"@nodaro/shared": patch
---

`EXECUTION_DATA_KEYS` gains `resultsRunId`: the id of the trigger-started run whose results a node shows. It is bookkeeping, so presets, templates and run-only patches never treat it as configuration.

---
"@nodaro/shared": patch
---

`EXECUTION_DATA_KEYS` gains `resultsRunEndedAt`: when the run whose results a node shows ended that node, recorded beside `resultsRunId`. It is bookkeeping, so presets, templates and run-only patches never treat it as configuration.

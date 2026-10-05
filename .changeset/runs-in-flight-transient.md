---
"@nodaro/shared": patch
---

`EXECUTION_DATA_KEYS` and `TRANSIENT_RUNTIME_KEYS` now include `__runsInFlight`, the editor's mark on a node for a paid run still out (one token per run). Like the other transient run-state keys, `stripTransientRuntimeData` removes it, so it is never saved, never makes a workflow dirty, and never reaches a preset or a template.

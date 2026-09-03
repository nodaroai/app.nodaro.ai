---
"@nodaro/shared": patch
---

`EXECUTION_DATA_KEYS` now includes `errorHint` — the structured safety-block
detail a node carries alongside `errorMessage` on a failed run (editor-side
`JobErrorHint`). Keeps it in the runtime/result key set: excluded from node
presets, exempt from undo capture like every other execution-state field, but
(unlike `TRANSIENT_RUNTIME_KEYS`) persisted across reload the same as
`errorMessage`.

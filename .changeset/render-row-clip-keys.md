---
"@nodaro/shared": minor
---

Add `renderPlanRowClipKeys`: the clip key of every iteration of a render's fan-out, row-aligned with its batch, under the same-run rule (`ranIds`: behind a pass-through node that did not run in the run, no row is keyed). Add `renderSentRowStamps` and `renderRunQuality`, so both engines stamp each batch row (a failed one too) with the quality and the clip it was sent for. `RunResultRowStamp` gains an optional `cancelled` (a row that never ran). `EXECUTION_DATA_KEYS` gains `__listResultStamps`, a render's row stamps on the node.

---
"@nodaro/sdk": minor
---

`edit.editPlan` takes `offsets` (an `audioSync` result over the same source ids) and `transcriptSourceId`. The measured offsets are written onto the sources before the request; a source that was not measured or matched weakly, an unmeasured master, or a transcript made from a source off the master's clock rejects with a `NodaroError` (`code: "edit_plan_sources"`) before any request or charge.

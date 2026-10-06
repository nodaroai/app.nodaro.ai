---
"@nodaro/shared": minor
"@nodaro/sdk": minor
---

A run can continue from an earlier execution. `workflows.run(id, { nodeIds, continueFromExecutionId })` runs only `nodeIds`; every other node hands on what that execution produced (an Edit Plan's plan with the person's review applied), never the workflow's saved results. Render final after a run that stopped at its preview is one: `{ nodeIds: [renderId, ...tail], inputOverrides: { [renderId]: { quality: "final" } }, continueFromExecutionId }`. The execution must be the caller's own completed run of the same workflow and the same version of its graph. `@nodaro/shared` adds the stable refusal codes `CONTINUATION_SUBSET_REQUIRED`, `CONTINUATION_NOT_FOUND`, `CONTINUATION_WORKFLOW_MISMATCH`, `CONTINUATION_VERSION_MISMATCH`, `CONTINUATION_NOT_COMPLETED`, and `RUN_CONTINUATION_CODES`. Additive.

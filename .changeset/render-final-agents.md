---
"@nodaro/sdk": minor
"@nodaro/shared": minor
---

Render final for agents. `workflows.renderFinal(id, { renderNodeId, continueFromExecutionId })` renders the final of an Apply EDL render whose run stopped at its preview: the render at Final for that run only, and every node after it (Camera Switch first, in multicam), continuing that execution. The server works out which nodes run, by the same rule as the editor's Render final button, so the caller sends only the render and the execution. `workflows.estimateRenderFinal(id, params)` quotes it first — the nodes it runs, the override it runs with, its estimated credits and whether the payer can cover them (`sufficient`, `available`) — without creating anything; a Render final its payer cannot cover throws `InsufficientCreditsError` before any execution exists. `@nodaro/shared` adds the stable refusal codes `RENDER_FINAL_NODE_NOT_FOUND`, `RENDER_FINAL_NOT_A_RENDER` and `RENDER_FINAL_CODES`. Additive.

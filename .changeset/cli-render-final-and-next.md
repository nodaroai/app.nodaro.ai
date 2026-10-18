---
"@nodaro/cli": minor
"@nodaro/sdk": patch
---

CLI: `nodaro workflows render-final <workflowId> --from <executionId> [--render <nodeId>]` renders the final of a run that stopped at a Preview render (the render at Final and every node after it, continuing that run); `--render` defaults to the workflow's only render, `--estimate` quotes it and runs nothing, and `--watch` follows it. `nodaro workflows run` takes `--override nodeId.field=value` (a per-node override for that run) and `--next <json|file|->`, which sends the `next` of a `continuation_preview_pending` answer exactly as given; a `--from-failed` refused with `continuation_preview_pending` now prints the exact command that finishes the held run. `--next` refuses a body that carries `continueMode` or `renderFinal` (a `next` never does), and the printed command quotes an argument that starts with `=`, which zsh would otherwise expand.

SDK: documents that a continuation (a run of named nodes, a `renderFinal`, a `next`, or a `continueMode: "from-failed"`) its payer cannot cover throws `InsufficientCreditsError` before any execution exists.

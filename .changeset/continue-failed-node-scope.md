---
"@nodaro/sdk": patch
"@nodaro/cli": patch
---

What a continue-from-failed (`continueMode: "from-failed"`, `nodaro workflows run --from-failed`) sent no `nodeIds` / `--node` considers: the nodes the first run of its chain was started on — a run started on named nodes (the editor's Run selected, an API `nodeIds`, a Render final) is continued on those; a run of every node, or one started before the nodes were recorded, on every node — plus every node left failed or held back by the run being continued, by a newer continuation it is built on, or by an earlier run of its chain, so a failure outside those nodes is always retried. `nodeIds` you send replace those nodes, and the run is built on the chain's newest continuation when it failed or its work is done (one held at a Preview review still answers `continuation_preview_pending`), and a node they name that is still left runs. The SDK's `RunWorkflowParams.continueMode` doc and the CLI's `--from-failed` help say so. `WorkflowExecution` gains `nodeScope` (`client.executions.get`): the nodes the first run of its chain was started on, `null` for every node.

---
"@nodaro/sdk": patch
"@nodaro/cli": patch
---

A continue-from-failed (`continueMode: "from-failed"`, `nodaro workflows run --from-failed`) counts every id in `nodeIds` / `--node` as named: a node of work no run of its chain ever ran (each only handed on its saved results) runs and is priced, while a source, trigger, parameter picker or container keeps what the run handed on and a node set to skip never runs. The SDK's `RunWorkflowParams.nodeIds` and `continueMode` docs and the CLI's `--from-failed` help say so; the `nodeIds` doc no longer says the default is every node.

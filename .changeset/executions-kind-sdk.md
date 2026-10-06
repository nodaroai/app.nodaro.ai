---
"@nodaro/sdk": patch
---

`WorkflowExecution` / `WorkflowExecutionSummary` (from `client.executions.get` / `listForWorkflow`) gain `kind`: `"execution"` for an orchestrator run, `"job"` for a single-node job the list shows beside the runs. `ExecutionTriggerType` now also names the `telegram`, `telegram_account`, `api` and `mcp` lanes the server already reported. Types only: no call changed.

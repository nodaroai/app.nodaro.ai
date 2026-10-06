---
"@nodaro/shared": minor
"@nodaro/sdk": minor
"@nodaro/prompts": minor
---

Runs that find nothing new end `completed` with `outcome: "nothing_new"` instead of failing. A text-requiring node (`llm-chat`, `generate-script`, `text-to-speech`, `generate-music`, `text-to-audio`, the legacy `ai-writer`) whose wired text came from a node that produced nothing in this run is skipped with `skipReason: "empty_input"` on its node state, and the nodes behind it are skipped with it.

- `@nodaro/shared`: `NodeSkipReason`, `skipReason` on `NodeExecutionStateWire`, `ExecutionOutcome` + `executionOutcome(status, nodeStates)` + `countEmptyInputSkips(nodeStates)` (the one rule every surface derives the outcome with — never a stored column), `__runSkipReason` among the transient runtime keys.
- `@nodaro/sdk`: `WorkflowExecution` / `WorkflowExecutionSummary` gain `outcome?: "succeeded" | "nothing_new"`; `nodeStates[id].skipReason`; `executionOutcome`, `countEmptyInputSkips`, `NodeSkipReason` and `ExecutionOutcome` re-exported.
- `@nodaro/prompts`: `TEXT_REQUIRED_NODE_TYPES`, `computeNodeSendText(type, data, args)` and `computeAiWriterInput(data, args)` — what a text-requiring node would send, by its executor's own rule.

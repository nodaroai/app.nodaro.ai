/**
 * `@nodaro/sdk/executions` — the `executions` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { ExecutionsResource } from "../resources/executions.js"

export type {
  WorkflowExecution,
  WorkflowExecutionSummary,
  NodeExecutionState,
  NodeExecutionStatus,
  NodeSkipReason,
  ExecutionOutcome,
  ExecutionStatus,
  ExecutionTriggerType,
  ListExecutionsForWorkflowParams,
  ListExecutionsPage,
  CancelExecutionParams,
} from "../resources/executions.js"

/** The rule for reading `NodeExecutionState.output`: a FAILED node carries one
 *  when its run retained a result, so gate on the field, never on the status. */
export { OUTPUT_BEARING_NODE_STATUSES, nodeStateMayCarryOutput } from "../resources/executions.js"

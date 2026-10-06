/**
 * The wire contract for one node's entry in an execution's `nodeStates` map —
 * the shape the orchestrator persists on `workflow_executions.node_states`,
 * emits on the SSE execution stream, and every client reads back.
 *
 * Why this lives here rather than in the backend
 * ----------------------------------------------
 * The shape had THREE independent declarations — the orchestrator's rich
 * `NodeExecutionState` (workflow-engine/types.ts), the SDK's loose one
 * (`packages/client/src/resources/executions.ts`) and the editor's local copy
 * (`workflow-editor/run-handlers.ts`) — and nothing tied them together. The
 * field that made that expensive is `output`: it used to be an unstated
 * convention that only a COMPLETED node carries one, so every consumer read it
 * exclusively under `status === "completed"` and a failed node's retained
 * result had nowhere to travel.
 *
 * This module states the rule once. The backend keeps its richer `NodeOutput`
 * typing (its `NodeExecutionState` must stay ASSIGNABLE to the wire shape — a
 * type-level test pins that); the SDK and the editor extend/import it.
 */

/**
 * The status a node reports inside an execution.
 *
 * `cancelled` is deliberately absent: a cancelled child job is mapped onto
 * `skipped` by the reconcile lane (see `lib/reconcile/node-states.ts`), and a
 * HELD job keeps `status: "running"` with the `awaitingReview` sidecar rather
 * than adding a member here.
 */
export type NodeExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"

/**
 * Why a node was skipped at run time, when the run itself decided it (never
 * for a node the person froze with Skip, which is a saved-data seed):
 *   - `empty_input` — a text-requiring node whose wired text came from a node
 *     that, in this run, produced nothing (a feed that found no new posts). A
 *     completed run with one such skip reads as "nothing new"
 *     (execution-outcome.ts).
 * A router-gated node carries no reason, as before.
 */
export type NodeSkipReason = "empty_input"

/**
 * The statuses whose node state MAY carry `output`.
 *
 * `completed` is the obvious one. `failed` is here because a run can refuse
 * its result and still RETAIN what it produced — the 3D-scene authoring lanes
 * publish a real, renderable revision and then fail the job on the visual
 * reviewer's verdict (`SCENE_QUALITY_FAILED`), so the scene and the refusal are
 * both true at once. That output was billed; dropping it because the status is
 * not `"completed"` is what this set exists to stop.
 *
 * `pending` / `running` / `skipped` never carry one: nothing has settled, or
 * the node was gated out.
 */
export const OUTPUT_BEARING_NODE_STATUSES: ReadonlySet<NodeExecutionStatus> =
  new Set<NodeExecutionStatus>(["completed", "failed"])

/** Whether a node in this status may carry `output`. */
export function nodeStateMayCarryOutput(status: string | undefined): boolean {
  return (
    status !== undefined &&
    OUTPUT_BEARING_NODE_STATUSES.has(status as NodeExecutionStatus)
  )
}

/**
 * One node's execution state, as it travels on the wire.
 *
 * Additive by construction — an older client ignores fields it does not know,
 * which is why `output` on a failed node is safe to start sending.
 *
 * `TOutput` lets a declaration that knows its own richer output shape (the
 * orchestrator's `NodeOutput`, the editor's) stay ASSIGNABLE to this contract
 * instead of restating it; the default is what an external client sees.
 */
export interface NodeExecutionStateWire<TOutput = Record<string, unknown>> {
  status: NodeExecutionStatus | (string & {})
  nodeType?: string
  jobId?: string | null
  /** Every job id of a fan-out node (one per list / loop iteration). */
  jobIds?: string[]
  creditsUsed?: number
  error?: string | null
  /** Stable code for a refusal a client may branch on — never on the text. */
  errorCode?: string
  /**
   * What the node produced.
   *
   * Present for a `completed` node, and for a `failed` node whose run RETAINED
   * a structured result (see {@link OUTPUT_BEARING_NODE_STATUSES}). A consumer
   * that reads it must therefore gate on the FIELD, not on the status, and
   * must not treat its presence as success.
   */
  output?: TOutput
  startedAt?: string | null
  completedAt?: string | null
  /** The node's job is parked in `pending_review`; `status` stays "running". */
  awaitingReview?: boolean
  progress?: number
  /** Present on a `skipped` node the RUN skipped (see {@link NodeSkipReason}); absent on a router-gated one. */
  skipReason?: NodeSkipReason | (string & {})
}

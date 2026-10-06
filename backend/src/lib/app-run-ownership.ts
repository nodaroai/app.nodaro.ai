/**
 * An app run and the execution it shows (decided 2026-10-06).
 *
 * `app_runs.execution_id` is server-owned: the backend writes it when a run
 * starts, and no client write path may set or change it (migration 469 limits
 * the browser roles to the PATCH's columns below). Every read that goes from a
 * run to its execution still asks `executionBelongsToRun`, because the
 * service-role client that embeds the execution bypasses RLS: a run row whose
 * pointer names someone else's execution must answer as if it were missing.
 *
 * The ownership model: an app run's execution is created by `executeAppRun`
 * (or the draft lane in `POST /v1/app/:slug/run`) with `user_id` = the runner
 * and `workflow_id` = the published app's underlying workflow.
 */

/**
 * What a client may change on its own run: the run PATCH's body field → its
 * column. The single allowlist — the route builds its UPDATE from it, and the
 * migration's column grant is guarded to equal it.
 */
export const APP_RUN_CLIENT_WRITABLE_FIELDS = {
  inputValues: "input_values",
  name: "name",
  hiddenNodes: "hidden_nodes",
  nodeStates: "node_states",
} as const

export type AppRunClientWritableField = keyof typeof APP_RUN_CLIENT_WRITABLE_FIELDS

export const APP_RUN_CLIENT_WRITABLE_COLUMNS: readonly string[] = Object.values(APP_RUN_CLIENT_WRITABLE_FIELDS)

/** The UPDATE a client's PATCH body may make: allowlisted fields only, the rest dropped. */
export function clientRunUpdates(body: Partial<Record<AppRunClientWritableField, unknown>>): Record<string, unknown> {
  const updates: Record<string, unknown> = {}
  for (const [field, column] of Object.entries(APP_RUN_CLIENT_WRITABLE_FIELDS) as Array<[AppRunClientWritableField, string]>) {
    if (body[field] !== undefined) updates[column] = body[field]
  }
  return updates
}

/**
 * Is this embedded execution the run's own? Its owner must be the runner, and
 * — when the app's workflow is known — it must be a run of that workflow. A
 * run with no execution (a draft) has nothing to check: callers keep it.
 */
export function executionBelongsToRun(
  execution: { user_id?: unknown; workflow_id?: unknown },
  run: { runnerId: string | null | undefined; workflowId?: string | null },
): boolean {
  if (!run.runnerId || execution.user_id !== run.runnerId) return false
  if (run.workflowId && execution.workflow_id !== run.workflowId) return false
  return true
}

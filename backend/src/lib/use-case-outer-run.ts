/**
 * THE RUN A USE-CASE NODE'S INNER RUN WORKS FOR (decided 2026-11-11).
 *
 * A use-case node runs as a hidden run of its own (`trigger_type` `use_case`,
 * `workflow_id` null: it executes a stored graph, not a saved workflow). When a
 * node of a running run started it, that inner run's provider words — on its
 * states and on its jobs — can quote the outer run's workflow, so they are
 * judged by that workflow (lib/provider-words-readers.ts). This stamp is the
 * link: `trigger_data.outerRun.executionId`, written once, at the inner run's
 * insert (services/use-case-execution.ts), from what the server alone knows —
 * the running run the node executor names on its internal call
 * (`parentExecutionIdOf`, the internal lane only), or, for a continuation
 * started from outside a run, the link of the run it continues. A run with no
 * link is a use-case job run on its own (or one from before the link was
 * recorded): its owner's.
 *
 * Read only through `serverStamps` (lib/trigger-data-stamps.ts), and only on
 * a `use_case` row — the narrower trust rule in lib/server-started-runs.ts
 * (`outerRunTriggerData`): that lane's one writer stores nothing else in
 * `trigger_data`. Its key is reserved, so caller data never carries it.
 */

const STAMP_KEY = "outerRun"

/** The `trigger_data` key the link is written under (reserved: never caller data, lib/trigger-data-stamps.ts). */
export const OUTER_RUN_STAMP_KEY = STAMP_KEY

/** The `trigger_data` an inner run is inserted with: the run it works for. */
export function outerRunStamp(executionId: string): Record<string, unknown> {
  return { [STAMP_KEY]: { executionId } }
}

/** The run a `trigger_data` value links, or `null` when it links none. */
export function outerRunOf(triggerData: unknown): string | null {
  if (typeof triggerData !== "object" || triggerData === null || Array.isArray(triggerData)) return null
  const stamp = (triggerData as Record<string, unknown>)[STAMP_KEY]
  if (typeof stamp !== "object" || stamp === null || Array.isArray(stamp)) return null
  const id = (stamp as Record<string, unknown>).executionId
  return typeof id === "string" && id.length > 0 ? id : null
}

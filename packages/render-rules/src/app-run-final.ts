/**
 * What an app run shows once its Render final has results (Render final in
 * the app runner, decided 2026-10-04). The final is a SECOND execution, a
 * continuation of the run: every node it does not run is a seed of the run
 * (`seededFromExecution`), so only a node the final COMPLETED itself replaces
 * the run's state — the render's final, and the nodes after it. While the final
 * renders, or after it failed, the run's own states (the preview) stay.
 *
 * ONE rule for the server's run views and the app runner following a final.
 * A chain of finals is laid over the run oldest first, each by this rule, so
 * a later final's seed of an earlier final's result never hides it.
 * Pure: returns `base` itself when the final replaces nothing.
 */
type States = Readonly<Record<string, unknown>>

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

export function appRunFinalStates<T extends States | null | undefined>(base: T, finalStates: unknown): T | Record<string, unknown> {
  if (!isRecord(finalStates)) return base
  let replaced: Record<string, unknown> | null = null
  for (const nodeId of appRunFinalReplacedIds(finalStates)) {
    replaced ??= { ...(isRecord(base) ? base : {}) }
    // Marked as a final's result. A Preview a final made (a second Preview
    // render further on) has its own Render final, continuing from the run's
    // newest final (a chain, decided 2026-10-06).
    replaced[nodeId] = { ...(finalStates[nodeId] as Record<string, unknown>), [FROM_RENDER_FINAL]: true }
  }
  return replaced ?? base
}

/**
 * The state key `appRunFinalStates` marks a state with when it is the final's
 * own result (decided 2026-10-06).
 */
export const FROM_RENDER_FINAL = "fromRenderFinal"

/**
 * The nodes whose run state a final replaces: those it COMPLETED itself, never
 * a seed it handed on. The runner's edits of these nodes were edits of the
 * preview; they go once the final ends (decided 2026-10-06).
 */
export function appRunFinalReplacedIds(finalStates: unknown): string[] {
  if (!isRecord(finalStates)) return []
  const ids: string[] = []
  for (const [nodeId, state] of Object.entries(finalStates)) {
    if (isRecord(state) && state.status === "completed" && !state.seededFromExecution) ids.push(nodeId)
  }
  return ids
}

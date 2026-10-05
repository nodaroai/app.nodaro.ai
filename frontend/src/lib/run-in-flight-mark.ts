/**
 * The mark a paid run leaves on the node its result will land on, when no
 * executor mark covers it (T100): one token per run still out, under
 * `__runsInFlight` in the node's data.
 *
 * It exists for the read-only freeze. A `view` or `none` answer for an open
 * canvas waits until no node shows a run in flight (`showsARunInFlight`),
 * because `updateNodeData` does nothing on a read-only canvas and would drop
 * the result of a job already paid for. The executors mark their nodes as part
 * of the run (a job's id, a status that reads `running`, …). A run started
 * from a character's or object's page, a Suno voice's setup, an overlay's
 * placement suggestion or a Character Studio's seed prompt suggestion has no
 * such mark of its own, so `withRunInFlight` (`hooks/run-in-flight.ts`) adds
 * this one around it.
 *
 * Transient: listed in `TRANSIENT_RUNTIME_KEYS` (`@nodaro/shared`), so it is
 * never saved, never makes the workflow dirty, and a reload starts without it
 * (the load drops one found in a row all the same). One token per run, not a
 * flag: two runs out on one node at once (Generate All Assets and a custom
 * variation) each clear only their own.
 *
 * The tokens are the runs this tab has out NOW, so nothing that puts back or
 * copies node data carries them. Undo history holds none
 * ({@link withoutRunsInFlight}), Undo and Redo keep each node's live tokens
 * ({@link withLiveRunsInFlight}), and a duplicate or a paste starts without
 * any (`buildDuplicatedNodeData` drops every transient key).
 *
 * Pure, so the graph-only modules (`clear-run-results.ts`) can name the key.
 */
export const RUNS_IN_FLIGHT_KEY = "__runsInFlight"

/** The runs still out on a node, by their tokens. Empty when none. */
export function runsInFlightOn(data: unknown): readonly string[] {
  const marks = (data as Record<string, unknown> | null | undefined)?.[RUNS_IN_FLIGHT_KEY]
  return Array.isArray(marks) ? (marks as readonly string[]) : []
}

/** `node` without its runs in flight. The same node when it holds none. */
export function withoutRunsInFlight<N extends { readonly data?: unknown }>(node: N): N {
  const data = node.data as Record<string, unknown> | null | undefined
  if (!data || !(RUNS_IN_FLIGHT_KEY in data)) return node
  const rest = { ...data }
  delete rest[RUNS_IN_FLIGHT_KEY]
  return { ...node, data: rest }
}

/**
 * `restored` with each node's runs in flight taken from `live`, the nodes on
 * the canvas now, by id: a restored node holds the tokens its live self holds,
 * and none when its live self holds none or is gone.
 *
 * For Undo and Redo, which put back a snapshot of the graph. No undo step
 * started or stopped one of these runs, and Undo does not stop one either: it
 * still writes its result when it ends. So a snapshot taken before a run
 * started must not take its token away while it is out (a freeze waiting for
 * it would land at once, and the result it then writes would be dropped), and
 * one taken while it was out must not bring back a token already released
 * (nothing would ever clear it).
 *
 * Only this mark. Undo past the start of an executor's run takes the job's id
 * back with the step, and the run's poll then sets its result aside
 * (`shouldAbandonNode`): that is how Undo treats those runs, and this leaves
 * it as it is.
 */
export function withLiveRunsInFlight<N extends { readonly id: string; readonly data?: unknown }>(
  restored: readonly N[],
  live: readonly N[],
): N[] {
  const liveMarks = new Map<string, readonly string[]>()
  for (const node of live) {
    const marks = runsInFlightOn(node.data)
    if (marks.length > 0) liveMarks.set(node.id, marks)
  }
  return restored.map((node) => {
    const marks = liveMarks.get(node.id)
    if (!marks) return withoutRunsInFlight(node)
    const data = (node.data ?? {}) as Record<string, unknown>
    if (data[RUNS_IN_FLIGHT_KEY] === marks) return node
    return { ...node, data: { ...data, [RUNS_IN_FLIGHT_KEY]: marks } }
  })
}

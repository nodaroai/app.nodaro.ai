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
 * from a character's or object's page, a Suno voice's setup or an overlay's
 * placement suggestion has no such mark of its own, so `withRunInFlight`
 * (`hooks/run-in-flight.ts`) adds this one around it.
 *
 * Transient: listed in `TRANSIENT_RUNTIME_KEYS` (`@nodaro/shared`), so it is
 * never saved, never makes the workflow dirty, and a reload starts without
 * it. One token per run, not a flag: two runs out on one node at once (Generate
 * All Assets and a custom variation) each clear only their own.
 *
 * Pure, so the graph-only modules (`clear-run-results.ts`) can name the key.
 */
export const RUNS_IN_FLIGHT_KEY = "__runsInFlight"

/** The runs still out on a node, by their tokens. Empty when none. */
export function runsInFlightOn(data: unknown): readonly string[] {
  const marks = (data as Record<string, unknown> | null | undefined)?.[RUNS_IN_FLIGHT_KEY]
  return Array.isArray(marks) ? (marks as readonly string[]) : []
}

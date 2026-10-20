/**
 * Which planned clips of a pack failed (decided 2026-10-18), counted once per
 * clip. A clip fails when its render row failed, or — on several cameras —
 * when its Camera Switch row failed: the switch runs once per clip and is
 * tried for every clip, and the render then runs once per clip whose switch
 * delivered (the engine skips a hole, so a failed switch row is never
 * rendered and nothing is reserved for it). A row that failed is one the run
 * started that came back with nothing; a row never started is stamped
 * `cancelled` (only a Stop leaves one, and a stopped run keeps nothing) and
 * is not a failure. A step that failed outright (no row list) failed every
 * clip it was given: the plan's. A pack with no switch (one recording, or one
 * camera with a Master audio) counts exactly its render's failures, as before.
 * Pure.
 */
import { isRecord, str } from "./wrapper-output-parts.js"

type State = { readonly status?: unknown; readonly output?: Readonly<Record<string, unknown>>; readonly error?: unknown; readonly errorCode?: unknown }

/** A per-clip step as the run left it: whether it failed outright, and each of its rows' file and stamp. */
export interface ClipStepRows {
  readonly failed: boolean
  readonly rows: readonly string[]
  readonly stamps: ReadonlyArray<Readonly<Record<string, unknown>>>
  /** Why it failed outright, in its own words. */
  readonly error?: string
}

/**
 * A per-clip step's rows from its state: its list (a hole is ""), else — a
 * step that ran once — its one value, read by `one`.
 */
export function clipStepRows(state: unknown, one: (out: Readonly<Record<string, unknown>>) => string | undefined): ClipStepRows {
  const s = (isRecord(state) ? state : {}) as State
  const failed = s.status === "failed"
  const out = s.status === "completed" ? s.output : undefined
  const error = failed ? (str(s.error) ?? str(s.errorCode)) : undefined
  if (!out) return { failed, rows: [], stamps: [], ...(error ? { error } : {}) }
  if (Array.isArray(out.listResults)) {
    const rows = (out.listResults as unknown[]).map((u) => str(u) ?? "")
    const stamps = Array.isArray(out.listResultStamps) ? (out.listResultStamps as unknown[]).map((st) => (isRecord(st) ? st : {})) : []
    return { failed, rows, stamps }
  }
  const value = one(out)
  return { failed, rows: value ? [value] : [], stamps: [out] }
}

/** The rows a step started that came back with nothing (a row never started is `cancelled`). */
const failedRows = (step: ClipStepRows): number => step.rows.filter((v, i) => !v && step.stamps[i]?.cancelled !== true).length

/** How many of the plan's `planned` clips failed, and why when a step failed outright (see the module note). */
export function clipPackFailedClips(input: {
  readonly planned: number
  readonly render: ClipStepRows
  /** The per-clip Camera Switch; absent for a pack built without one. */
  readonly switched?: ClipStepRows
}): { readonly failedClips: number; readonly reason?: string } {
  const { planned, render, switched } = input
  // A switch that failed outright failed every clip: none reached the render.
  if (switched?.failed) return { failedClips: planned, ...(switched.error ? { reason: switched.error } : {}) }
  // A render that failed outright failed every clip it was given — every clip whose switch delivered — so with the switch's own failures, the plan's.
  if (render.failed) return { failedClips: planned, ...(render.error ? { reason: render.error } : {}) }
  return { failedClips: (switched ? failedRows(switched) : 0) + failedRows(render) }
}

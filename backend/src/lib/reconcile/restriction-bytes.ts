/**
 * The restriction bytes' sweep (migration 583): every restriction whose
 * bytes are not where its side says they should be — a key still at its
 * public address after a restriction, or still in evidence after a lift
 * (deferred while another restriction covered it, or failed), an edge purge
 * that failed — is finished again (lib/content-restrictions.ts
 * `finishRestrictionBytes`). That is how a move cut short by a crash, a
 * provider hiccup or a request timeout is completed without anyone noticing
 * it was not: the record says what is left, this sweep does it.
 *
 * Bounded: the newest `SWEEP_LIMIT` records of each side a run (the active
 * ones by their restriction, the lifted ones by their lift), so a record
 * that keeps failing (a key the deployment cannot move) costs one attempt a
 * run and never holds the others back. The reconcile tick is minutes; this
 * sweep runs at most once an `SWEEP_EVERY_MS`. Best effort: a failure is
 * counted and logged, never thrown.
 */
import { supabase } from "../supabase.js"
import { bytesSettled, type RestrictionBytes } from "../content-restriction-bytes.js"
import { finishRestrictionBytes } from "../content-restrictions.js"
import { isMissingColumnError, isMissingTableError } from "../postgrest-errors.js"

export const SWEEP_LIMIT = 100
/** How often the sweep runs: the moves are storage copies, not something to retry every tick. */
export const SWEEP_EVERY_MS = 60 * 60 * 1000

export interface RestrictionBytesSweepResult {
  readonly finished: number
  readonly errors: number
}

interface Row {
  id: string
  r2_keys: string[] | null
  lifted_at: string | null
  bytes: RestrictionBytes | null
}

let lastRunAt = Number.NEGATIVE_INFINITY

/** Test-only: forget when the sweep last ran. */
export function _resetRestrictionBytesSweepForTests(): void {
  lastRunAt = Number.NEGATIVE_INFINITY
}

async function candidates(side: "active" | "lifted"): Promise<{ rows: Row[]; error: { code?: string; message: string } | null }> {
  const base = supabase.from("content_restrictions").select("id, r2_keys, lifted_at, bytes")
  const query = side === "active"
    ? base.is("lifted_at", null).order("restricted_at", { ascending: false })
    : base.not("lifted_at", "is", null).order("lifted_at", { ascending: false })
  const { data, error } = await query.limit(SWEEP_LIMIT)
  return { rows: ((data ?? []) as Row[]), error }
}

export async function sweepRestrictionBytes(now = Date.now()): Promise<RestrictionBytesSweepResult> {
  if (now - lastRunAt < SWEEP_EVERY_MS) return { finished: 0, errors: 0 }
  lastRunAt = now
  let finished = 0
  let errors = 0
  for (const side of ["active", "lifted"] as const) {
    const { rows, error } = await candidates(side)
    if (error) {
      // A database before 583 has no record to finish: nothing to do.
      if (isMissingColumnError(error) || isMissingTableError(error)) return { finished, errors }
      console.error(`[reconcile/restriction-bytes] candidate scan (${side}) failed: ${error.message}`)
      errors++
      continue
    }
    for (const row of rows) {
      const restriction = { id: row.id, r2Keys: row.r2_keys ?? [], liftedAt: row.lifted_at, bytes: row.bytes ?? {} }
      if (bytesSettled(restriction)) continue
      try {
        const after = await finishRestrictionBytes(row.id)
        if (bytesSettled(after)) finished++
        else errors++
      } catch (err) {
        console.error(`[reconcile/restriction-bytes] finishing ${row.id} threw:`, err)
        errors++
      }
    }
  }
  return { finished, errors }
}

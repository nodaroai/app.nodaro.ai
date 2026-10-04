/**
 * `jobs.slot_wait_ms` (migration 451, Track 0.13) until it reaches the database.
 *
 * Staging runs dev against the SHARED database, and migrations apply only at the
 * dev→main promotion — so for that window the column does not exist, and a read
 * or write that names it fails the WHOLE statement (an UPDATE … RETURNING that
 * names it is not applied at all). Every site that names the column goes
 * through here: on a missing-column error it is remembered as absent for the
 * life of the process (a deploy that applies the migration restarts it) and
 * the caller retries without it. Absent means a wait of 0 — today's behaviour.
 */

/** 42703: undefined column (Postgres); PGRST204: unknown column in a write (PostgREST). */
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"])

let absent = false

/** True when `error` says a named column does not exist (and records it). */
export function noteSlotWaitColumnError(error: { readonly code?: string | null } | null | undefined): boolean {
  if (!error?.code || !MISSING_COLUMN_CODES.has(error.code)) return false
  absent = true
  return true
}

/** Is the column known to be missing in this process? */
export function slotWaitColumnAbsent(): boolean {
  return absent
}

/** `columns` plus `slot_wait_ms`, unless the column is known to be missing. */
export function withSlotWaitColumn(columns: string): string {
  return absent ? columns : `${columns}, slot_wait_ms`
}

/** For tests. */
export function resetSlotWaitColumnForTests(): void {
  absent = false
}

import { isMissingFunctionError } from "../../../lib/postgrest-errors.js"
import { refuse } from "./refusal.js"
import { storageBytes } from "./rows.js"

/**
 * The ceiling on the bytes of video-editor project files one person holds:
 * their live projects' current files plus every version of those projects
 * (`editor_project_storage_bytes`, migration 711). Checked before a save or a
 * cut writes a file, after the ownership check and before any heavy work, so
 * the size counted for the new file is the one known then (see each caller).
 *
 * A database without the function yet (staging and production run this code
 * before the migration reaches them) has no ceiling: the check is skipped, and
 * the absence is remembered for `ABSENT_RECHECK_MS` so a save does not pay a
 * failed call each time. Any other error from the call is thrown as it came
 * (a 500 through the one mapping; a missing table is still 503 there).
 */

export const STORAGE_CEILING_BYTES = 2 * 1024 * 1024 * 1024
const ABSENT_RECHECK_MS = 60_000

let absentUntil = 0

/** The bytes `userId` stores now, or null when this database has no ceiling (no function yet). */
export async function storedTotal(userId: string): Promise<number | null> {
  if (Date.now() < absentUntil) return null
  try {
    return await storageBytes(userId)
  } catch (err) {
    if (isMissingFunctionError(err)) {
      absentUntil = Date.now() + ABSENT_RECHECK_MS
      return null
    }
    throw err
  }
}

/** 413 `project_storage_full` when `total` (from `storedTotal`) plus `newBytes` passes the ceiling; nothing when there is none. */
export function requireRoom(total: number | null, newBytes: number): void {
  if (total !== null && total + newBytes > STORAGE_CEILING_BYTES) throw refuse(413, "project_storage_full")
}

/** 413 `project_storage_full` unless `userId` has room for `newBytes` more (one call to the database). */
export async function requireRoomFor(userId: string, newBytes: number): Promise<number | null> {
  const total = await storedTotal(userId)
  requireRoom(total, newBytes)
  return total
}

/** Test hook: forget a remembered absence of the function. */
export function __resetStorageCeilingForTests(): void {
  absentUntil = 0
}

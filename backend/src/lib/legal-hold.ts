/**
 * The legal hold (migration 582): evidence is never deleted. A stored file is
 * held while an administrator's restriction covers it or while an open,
 * verified complaint case matches it; the hold is a predicate over those
 * records, answered by the database, never a flag of its own.
 *
 * This module is the storage layer's question (`deleteFromR2` /
 * `batchDeleteFromR2` ask {@link heldAmong} before any delete) and the account
 * deletion's ({@link userHasHeldContent}). It reads FRESH, with no cache, and
 * FAILS CLOSED: when the database cannot answer, {@link heldAmong} THROWS
 * {@link LegalHoldUnavailableError} instead of answering, so the delete that
 * asked fails as a delete fails — recorded for the retry pass where the
 * caller records (lib/storage-delete.ts), and tried again — rather than
 * passing as done with the bytes left behind. Do not "fix" the failure arm
 * into a pass, and do not turn it into a silent keep either: a key skipped
 * without a record is an object nothing points at any more.
 *
 * One exception reads as "nothing held": the hold's functions do not exist
 * yet (a server running ahead of the migration, on staging or locally). No
 * restriction or complaint can exist before them either.
 *
 * A leaf module on purpose (the database client only, loaded when first
 * asked): the storage module is imported everywhere, so a test of a storage
 * caller mocks this file, never the database.
 */
import { isMissingFunctionError } from "./postgrest-errors.js"

/**
 * The database client, loaded when first asked: the storage module imports
 * this one, and a test of a storage caller that never deletes must not have
 * to configure a database to load it.
 */
async function db() {
  return (await import("./supabase.js")).supabase
}

/** A chunk of keys per question; a batch delete can carry a thousand. */
const HELD_QUESTION_CHUNK = 500

/** The hold could not be read: the delete that asked must not go on. */
export class LegalHoldUnavailableError extends Error {
  readonly code = "legal_hold_unavailable" as const
  constructor(detail: string) {
    super(`The legal hold could not be read: ${detail}`)
    this.name = "LegalHoldUnavailableError"
  }
}

let warnedMissing = false
function missingFunctions(name: string): void {
  if (warnedMissing) return
  warnedMissing = true
  console.warn(`[legal-hold] ${name} does not exist yet (migration 582 not applied); nothing is held until it is`)
}

/**
 * The keys among `keys` that are held. Throws {@link LegalHoldUnavailableError}
 * when a question cannot be answered (fail closed: the caller's delete fails
 * and is recorded, never skipped as done).
 */
export async function heldAmong(keys: readonly string[]): Promise<Set<string>> {
  const held = new Set<string>()
  const unique = [...new Set(keys)]
  for (let i = 0; i < unique.length; i += HELD_QUESTION_CHUNK) {
    const chunk = unique.slice(i, i + HELD_QUESTION_CHUNK)
    const { data, error } = await (await db()).rpc("held_storage_keys_among", { p_keys: chunk })
    if (error) {
      if (isMissingFunctionError(error)) {
        missingFunctions("held_storage_keys_among")
        return held
      }
      console.error(`[legal-hold] the hold could not be read for ${chunk.length} key(s): ${error.message}`)
      throw new LegalHoldUnavailableError(error.message)
    }
    for (const key of (data ?? []) as string[]) held.add(key)
  }
  return held
}

/** Whether the account holds any file or job under hold (an account under hold is not deleted). Fails closed: an unanswerable account counts as held. */
export async function userHasHeldContent(userId: string): Promise<boolean> {
  const { data, error } = await (await db()).rpc("user_has_held_content", { p_user_id: userId })
  if (error) {
    if (isMissingFunctionError(error)) {
      missingFunctions("user_has_held_content")
      return false
    }
    console.error(`[legal-hold] the hold could not be read for ${userId}; counted as held: ${error.message}`)
    return true
  }
  return data === true
}

/**
 * The job reads of the share links: one job of an owner, and its restricted
 * files. A job in the Trash and a child job of a larger run are never loaded
 * (each reads as a job that does not exist, as on every read by id).
 */
import { supabase } from "../supabase.js"
import { CHILD_JOB_COLUMN, TRASHED_JOB_COLUMN } from "../public-job-data.js"
import { noteTitleColumnError, titleSelect } from "../jobs-title-column.js"
import { restrictedKeyOfAddress } from "../content-restriction-address.js"
import { restrictedKeysNow } from "../content-restriction-set.js"
import { isEvidenceKey } from "../evidence-keys.js"
import { SHARE_JOB_COLUMNS, mediaOf, shareRefusalOf, type ShareJobRow } from "./shared-job.js"
import type { ShareRefusal } from "./types.js"

/** The owner's live, top-level job, or null. */
export async function findOwnerJob(ownerId: string, jobId: string): Promise<ShareJobRow | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase
      .from("jobs")
      .select(`${SHARE_JOB_COLUMNS}${titleSelect()}`)
      .eq("id", jobId)
      .eq("user_id", ownerId)
      .is(CHILD_JOB_COLUMN, null)
      .is(TRASHED_JOB_COLUMN, null)
      .maybeSingle()
    if (!error) return (data as unknown as ShareJobRow | null) ?? null
    // The name column left this database's schema: read again without it.
    if (attempt === 0 && noteTitleColumnError(error)) continue
    throw new Error(`share job read failed: ${error.message}`)
  }
  return null
}

/**
 * The owner's top-level job whether or not it is in the Trash: only to read
 * and turn OFF its link (a link to a job moved to the Trash must still be
 * turned off, or it would come back with the job). Never shown to anyone.
 */
export async function findOwnerJobAnyState(ownerId: string, jobId: string): Promise<ShareJobRow | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase
      .from("jobs")
      // trash-read: the owner's own job, to read or turn off its share link; a trashed job is never shown or shared (findOwnerJob).
      .select(`${SHARE_JOB_COLUMNS}${titleSelect()}`)
      .eq("id", jobId)
      .eq("user_id", ownerId)
      .is(CHILD_JOB_COLUMN, null)
      .maybeSingle()
    if (!error) return (data as unknown as ShareJobRow | null) ?? null
    // The name column left this database's schema: read again without it.
    if (attempt === 0 && noteTitleColumnError(error)) continue
    throw new Error(`share job read failed: ${error.message}`)
  }
  return null
}

/**
 * Whether a file address names restricted bytes: one of ours under an active
 * content restriction, or under the evidence prefix (migration 583). Asked as
 * this server knows the restrictions now, never waited on (as the job gate
 * asks); the job row's own `restricted_at` is the authoritative mark.
 */
export function isRestrictedAddress(url: string): boolean {
  const key = restrictedKeyOfAddress(url)
  if (!key) return false
  return isEvidenceKey(key) || restrictedKeysNow().has(key)
}

/** `shareRefusalOf`, plus the bytes: a job whose output names restricted bytes is restricted too. */
export function jobShareRefusal(row: ShareJobRow): ShareRefusal | null {
  const refusal = shareRefusalOf(row)
  if (refusal) return refusal
  const media = mediaOf(row.output_data)
  return media && media.urls.some(isRestrictedAddress) ? "restricted" : null
}

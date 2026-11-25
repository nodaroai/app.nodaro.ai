import { supabase } from "./supabase.js"
import { isMissingFunctionError } from "./postgrest-errors.js"

/** The most outputs one bulk removal may name. */
export const MAX_GALLERY_REMOVAL = 100

/**
 * Take outputs out of the public gallery: `is_public = false` — the job and
 * its file stay, its creator still sees it; only discovery ends — and every
 * pending report on them is marked reviewed, in one transaction. What that
 * means is defined once, in the database (`remove_jobs_from_gallery`,
 * migration 706); the single admin delete, the bulk one and the private
 * switch (`makeOutputsPrivate` below) all come through it, so they cannot
 * drift.
 *
 * Throws when the removal failed; nothing was changed then.
 */
export async function removeFromGallery(jobIds: readonly string[]): Promise<{ removed: number }> {
  const ids = [...new Set(jobIds)]
  if (ids.length === 0) return { removed: 0 }

  const { data, error } = await supabase.rpc("remove_jobs_from_gallery", { p_job_ids: ids })
  if (!error) return { removed: typeof data === "number" ? data : 0 }
  // Migration 706 reaches the shared database only when main deploys, and
  // staging runs this code first. Until then the removal keeps its earlier
  // shape. Remove this branch once 706 is applied everywhere.
  if (isMissingFunctionError(error)) return removeFromGalleryBeforeMigration706(ids)
  throw new Error(`Failed to remove from the gallery: ${error.message}`)
}

async function removeFromGalleryBeforeMigration706(ids: string[]): Promise<{ removed: number }> {
  const { data, error } = await supabase.from("jobs").update({ is_public: false }).in("id", ids).select("id")
  if (error) throw new Error(`Failed to remove from the gallery: ${error.message}`)

  const { error: reportsError } = await supabase
    .from("gallery_reports")
    .update({ status: "reviewed" })
    .in("job_id", ids)
    .eq("status", "pending")
  if (reportsError) console.error("[gallery] Failed to auto-review reports:", reportsError)

  return { removed: data?.length ?? 0 }
}

/** Why `makeOutputsPrivate` did not switch the setting. */
export class MakeOutputsPrivateError extends Error {
  constructor(
    message: string,
    /** `unavailable`: this database does not have the function yet (staging before main deploys). */
    readonly reason: "unavailable" | "failed",
  ) {
    super(message)
    this.name = "MakeOutputsPrivateError"
  }
}

/**
 * Switch a person's outputs to private: `profiles.public_outputs = false` AND
 * every one of their rows still in the public gallery taken out of it, with
 * their pending reports marked reviewed (`removeFromGallery`'s definition), in
 * ONE transaction (`make_outputs_private`, migration 706). Either both happen
 * or neither does. Calling it again is safe: it then hides only what turned
 * public since.
 *
 * It is called TWICE, the second time after the first has committed. A
 * generation that completed while the first transaction was still open read
 * the preference as it was before (public), so the database could not keep
 * it private; the second call takes it out. Every completion after the first
 * commit reads `false`, and the database keeps it private (the jobs trigger
 * `keep_private_owner_jobs_private`), as it does every row the switch hid,
 * even after the person switches back to public. `hidden` is the sum of both
 * calls.
 *
 * Switching back to public is a plain preference write that republishes
 * nothing: what was hidden stays private.
 *
 * The only writer of `public_outputs = false`. Throws `MakeOutputsPrivateError`
 * when either call failed: then nothing was changed (first call) or the
 * setting is private but a straggler may still be listed (second call); in
 * both cases calling again finishes the job.
 */
export async function makeOutputsPrivate(userId: string): Promise<{ hidden: number }> {
  const first = await callMakeOutputsPrivate(userId)
  const second = await callMakeOutputsPrivate(userId)
  return { hidden: first + second }
}

async function callMakeOutputsPrivate(userId: string): Promise<number> {
  const { data, error } = await supabase.rpc("make_outputs_private", { p_user_id: userId })
  if (error) {
    if (isMissingFunctionError(error)) {
      throw new MakeOutputsPrivateError("make_outputs_private is not in this database yet", "unavailable")
    }
    throw new MakeOutputsPrivateError(`Failed to make outputs private: ${error.message}`, "failed")
  }
  return typeof data === "number" ? data : 0
}

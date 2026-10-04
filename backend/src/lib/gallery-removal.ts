import { supabase } from "./supabase.js"

/** The most outputs one bulk removal may name. */
export const MAX_GALLERY_REMOVAL = 100

/**
 * Take outputs out of the public gallery: `is_public = false` — the job and
 * its file stay, its creator still sees it; only discovery ends — and every
 * pending report on them is marked reviewed. The single admin delete and the
 * bulk one both come through here, so the two cannot drift.
 *
 * Throws when the jobs could not be updated; a failed report update is
 * logged and does not undo the removal.
 */
export async function removeFromGallery(jobIds: readonly string[]): Promise<{ removed: number }> {
  const ids = [...new Set(jobIds)]
  if (ids.length === 0) return { removed: 0 }

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

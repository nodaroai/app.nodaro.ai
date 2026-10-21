/**
 * The terminal `completed` write of a SYNCHRONOUS metered LLM job, after its
 * settle (R38).
 *
 * The write is a CAS on the live statuses. A cancel that ran while the call
 * was in flight kept the job's hold (R36: billed-unknown) and left the row
 * `cancelled`; the route's settle then charges the call (D10 — the charge
 * stands), but the row must stay `cancelled`: an unconditional `.eq("id")`
 * write turned it back into `completed`. The same CAS keeps a row the
 * reconcile sweep already failed from being flipped back.
 *
 * Only the METERED paths call this — a route's rollback (tier) branch keeps
 * its own write, byte-identical. The guard in `lib/__tests__/metered-sync-completion.test.ts` holds
 * every file that settles a metered LLM job to it.
 */
import { supabase } from "./supabase.js"
import { completedJobColumns } from "./job-status.js"
import { FAILABLE_STATUSES } from "./job-failure.js"

/**
 * Mark a settled synchronous metered job `completed` — unless it is no longer
 * live (cancelled, or failed by the sweep), which is left as it is. `userId`
 * scopes the write to the job's owner where the route's own writes do.
 * Never throws; answers whether the row was completed.
 */
export async function completeSettledSyncJob(jobId: string, scope: { userId?: string } = {}): Promise<boolean> {
  try {
    let write = supabase
      .from("jobs") // tenant-scope-ignore: the route created this job in this request
      .update({ status: "completed", ...completedJobColumns() })
      .eq("id", jobId)
    if (scope.userId !== undefined) write = write.eq("user_id", scope.userId)
    const { data, error } = await write.in("status", [...FAILABLE_STATUSES]).select("id")
    if (error) {
      console.warn(`[metered-sync] could not mark job ${jobId} completed: ${error.message}`)
      return false
    }
    if (!Array.isArray(data) || data.length === 0) {
      console.log(`[metered-sync] job ${jobId} is no longer live (cancelled while its call ran) — left as it is; its settled charge stands`)
      return false
    }
    return true
  } catch (err) {
    console.warn(`[metered-sync] could not mark job ${jobId} completed:`, err)
    return false
  }
}

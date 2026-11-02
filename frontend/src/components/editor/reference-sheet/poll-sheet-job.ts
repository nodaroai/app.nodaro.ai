import { getJobStatusLean } from "@/lib/api"
import { tx } from "@/lib/i18n"
import { QueuedPollClock } from "@/lib/queued-poll-clock"

/** How often a sheet compose job is read. */
export const SHEET_POLL_MS = 2000
/** ~6 min at SHEET_POLL_MS — reads that find the job waiting for a free slot do not count. */
export const SHEET_POLL_MAX_ATTEMPTS = 180

/**
 * Follow a reference-sheet compose job to its image (both sheet panels: the
 * character's and the classic chip UI of objects and locations).
 *
 * A transient read failure is retried next tick; a TERMINAL job status
 * (completed/failed/cancelled) always ends the loop — never the timeout just
 * because a `failed` job's message didn't match some pattern. It gives up
 * after SHEET_POLL_MAX_ATTEMPTS reads, not counting a read that finds the job
 * `queued` — waiting for a free slot (up to the most queued time any clock
 * credits, lib/queued-poll-clock.ts) — so waiting in line never times a sheet
 * out; every other read counts as before.
 */
export async function pollSheetJob(jobId: string): Promise<{ imageUrl: string; panelUrls: string[] }> {
  const queued = new QueuedPollClock()
  let counted = 0
  while (counted < SHEET_POLL_MAX_ATTEMPTS) {
    await new Promise((r) => setTimeout(r, SHEET_POLL_MS))
    let job: Awaited<ReturnType<typeof getJobStatusLean>>
    try {
      job = await getJobStatusLean(jobId)
    } catch {
      queued.observe(undefined)
      counted += 1
      continue // transient fetch failure — retry
    }
    if (!queued.observe(job.status)) counted += 1
    if (job.status === "completed") {
      const out = job.output_data as { imageUrl?: string; panelUrls?: string[] } | undefined
      if (out?.imageUrl) return { imageUrl: out.imageUrl, panelUrls: out.panelUrls ?? [] }
      throw new Error(tx("entity.sheetNoImageUrl"))
    }
    // A held job is parked on a human reviewer and will outlive this bound by
    // hours. Break out NOW with the truth instead of falling through to
    // "timed out" (a lie) or an empty panel that never fills.
    if (job.status === "pending_review") throw new Error(tx("sheet.panelAwaitingReview"))
    if (job.status === "failed" || job.status === "cancelled") {
      throw new Error(job.error_message ?? tx(job.status === "cancelled" ? "entity.sheetCancelledFallback" : "entity.sheetFailedFallback"))
    }
  }
  throw new Error(tx("entity.sheetTimedOut"))
}

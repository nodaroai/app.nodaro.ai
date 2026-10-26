/**
 * What a job cost, for display. A job's `credits` is its own HOLD, taken when
 * it was accepted, and never changes; the job can settle below it (a re-render
 * ceiling, a measured length) and the rest goes back to the balance. A job is
 * also a RUN: the steps it ran (child jobs — a Nodaro Motion run's reference
 * preparation, mask and video) are billed on their own, so the server reports
 * the run's figures: `credits_charged` (its settled charge, the steps'
 * included), `credits_held` (its hold, the steps' included) and
 * `credits_released` (what went back, once every hold in the run settled).
 * Admins also receive `credits_actual` (the job's own). Show the charge once it
 * is known, the hold until then.
 */
export interface JobCreditsInput {
  /** The job's own hold's lifecycle ("reserved" while it is open). */
  credit_status?: "reserved" | "committed" | "refunded" | null
  credits?: number | null
  credits_charged?: number | null
  credits_held?: number | null
  credits_released?: number | null
  credits_actual?: number | null
}

export interface JobCreditsShown {
  /** The figure to show: the charge once settled, else the hold. Null when neither is known. */
  shown: number | null
  /** The run's hold (the job's own when the server sent no run figure), for context beside a lower charge. */
  held: number | null
  /** The settled charge; null until the job settles. */
  charged: number | null
  /** What went back from the hold once every hold in the run settled; null until then (or unknown). */
  released: number | null
  /** True while the hold is still open — only then is the figure a hold to label as such. */
  open: boolean
}

export function jobCreditsShown(job: JobCreditsInput): JobCreditsShown {
  const charged = job.credits_charged ?? job.credits_actual ?? null
  const held = job.credits_held ?? job.credits ?? null
  const released = charged != null && held != null && job.credits_released != null ? job.credits_released : null
  const open = charged == null && job.credit_status === "reserved"
  return { shown: charged ?? held, held, charged, released, open }
}

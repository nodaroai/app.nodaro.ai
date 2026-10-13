/**
 * What a job cost, for display. A job's `credits` is the HOLD taken when it
 * was accepted and never changes; the job can settle below it (a re-render
 * ceiling, a measured length) and the rest goes back to the balance. The
 * server reports the settled charge as `credits_charged` (read through its one
 * charge reader); admins also receive `credits_actual`. Show the charge once
 * it is known, the hold until then.
 */
export interface JobCreditsInput {
  credits?: number | null
  credits_charged?: number | null
  credits_actual?: number | null
}

export interface JobCreditsShown {
  /** The figure to show: the charge once settled, else the hold. Null when neither is known. */
  shown: number | null
  /** The hold, for context beside a lower charge. */
  held: number | null
  /** The settled charge; null until the job settles. */
  charged: number | null
}

export function jobCreditsShown(job: JobCreditsInput): JobCreditsShown {
  const charged = job.credits_charged ?? job.credits_actual ?? null
  const held = job.credits ?? null
  return { shown: charged ?? held, held, charged }
}

/**
 * Canonical `jobs.status` vocabulary — the single source of truth the wire
 * schemas (routes/jobs.ts) and every status-filtered query derive from.
 *
 * NOTE: "running" is NOT a jobs status (that's the workflow_executions state
 * machine — see ACTIVE_EXECUTION_STATUSES in lib/request-helpers.ts). Media
 * workers write "processing" when they pick a job up (workers/shared.ts uses
 * ["pending", "processing"] as its completed-write guard); MCP pipeline/app
 * paths write "queued". Filtering jobs on "running" matches nothing, ever —
 * that exact mistake made the Character/Location Studios lose their spinners
 * on refresh: the rehydration query couldn't see jobs the worker had already
 * started (most of a generation's visible lifetime).
 */
export const JOB_STATUSES = ["pending", "queued", "processing", "pending_review", "completed", "failed", "cancelled"] as const

export type JobStatus = (typeof JOB_STATUSES)[number]

/** Non-terminal statuses — a job still on its way to a result. Use for every
 *  "is anything in flight?" query (studio spinner rehydration, dedup checks).
 *
 *  `pending_review` IS in-flight (spec 2026-09-03-job-policy-hook-design D14):
 *  the media exists but is withheld and the credits are still reserved, so
 *  every waiter — the SDK's runAndWait, the canvas poll loops, MCP
 *  `_wait-for-job`, the studio spinner rehydration — must keep waiting rather
 *  than treat it as done or failed. Putting it in TERMINAL_JOB_STATUSES instead
 *  makes all of them stop early on a job a human has not released yet. */
export const IN_FLIGHT_JOB_STATUSES = ["pending", "queued", "processing", "pending_review"] as const satisfies readonly JobStatus[]

/** Statuses that end a job's lifecycle. Complements IN_FLIGHT_JOB_STATUSES —
 *  the partition is guarded by lib/__tests__/job-status.test.ts. */
export const TERMINAL_JOB_STATUSES = ["completed", "failed", "cancelled"] as const satisfies readonly JobStatus[]

/** In-flight but NOT progressing on its own — the job is parked on a human.
 *  Every timeout / stall / abandon sweep must EXEMPT these: their clock is a
 *  review queue's, not a worker's. Named separately from IN_FLIGHT so an
 *  exemption reads as a positive assertion (`isParkedJobStatus`) instead of an
 *  omission nobody notices.
 *
 *  A SUBSET of IN_FLIGHT_JOB_STATUSES, never a fourth partition — asserted in
 *  lib/__tests__/job-status.test.ts.
 *
 *  The ONE permitted writer of a parked row is `sweepExpiredHolds`
 *  (JOB_HOLD_TTL_HOURS), which auto-rejects an abandoned review so the
 *  reservation is returned rather than stranded. */
export const PARKED_JOB_STATUSES = ["pending_review"] as const satisfies readonly JobStatus[]

/** Narrowing predicate for the parked set. Takes a `string` (not `JobStatus`)
 *  on purpose: the callers are readers of a raw `jobs.status` column value. */
export function isParkedJobStatus(s: string): s is (typeof PARKED_JOB_STATUSES)[number] {
  return (PARKED_JOB_STATUSES as readonly string[]).includes(s)
}

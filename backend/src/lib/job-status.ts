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
export const JOB_STATUSES = ["pending", "queued", "processing", "completed", "failed", "cancelled"] as const

export type JobStatus = (typeof JOB_STATUSES)[number]

/** Non-terminal statuses — a job still on its way to a result. Use for every
 *  "is anything in flight?" query (studio spinner rehydration, dedup checks). */
export const IN_FLIGHT_JOB_STATUSES = ["pending", "queued", "processing"] as const satisfies readonly JobStatus[]

/** Statuses that end a job's lifecycle. Complements IN_FLIGHT_JOB_STATUSES —
 *  the partition is guarded by lib/__tests__/job-status.test.ts. */
export const TERMINAL_JOB_STATUSES = ["completed", "failed", "cancelled"] as const satisfies readonly JobStatus[]

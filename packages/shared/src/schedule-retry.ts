/**
 * Schedule Trigger "Retry on failure" — the ONE shape both sides read.
 *
 * A scheduled run nobody watches can fail for a reason that passes
 * (a provider lane down for a while). With a retry policy on the node, the
 * server runs the failed run again after a wait, a bounded number of times;
 * absent, nothing is retried and the schedule behaves exactly as before.
 *
 * - `afterMinutes` — how long after the failure the retry may start.
 * - `maxAttempts` — how many retries one failed scheduled run may get
 *   (the original run is not an attempt).
 * - `cheapLanesOnly` — the model calls made by the run (the original
 *   scheduled run AND its retries) that honour the flag stay on the
 *   aggregator lane: a call that fails there is not re-asked on the vendor's
 *   own, pricier API; it fails, and the retry handles it later. Which node
 *   types honour it is listed on the Schedule Trigger's docs page
 *   (docs/nodes/input/schedule-trigger.md, "Cheap lanes only").
 *
 * The node stores it as `data.retry`, the server projects it onto the
 * trigger row's `config.retry` (lib/workflow-trigger-sync.ts), and the API
 * takes the same object in `config` (POST / PATCH /v1/workflow-triggers).
 */

export interface ScheduleRetry {
  /** 5–1440 (a day). */
  readonly afterMinutes: number
  /** 1–5. */
  readonly maxAttempts: number
  readonly cheapLanesOnly: boolean
}

export const SCHEDULE_RETRY_LIMITS = {
  afterMinutes: [5, 1440] as const,
  maxAttempts: [1, 5] as const,
} as const

export const SCHEDULE_RETRY_DEFAULTS: ScheduleRetry = Object.freeze({
  afterMinutes: 30,
  maxAttempts: 3,
  cheapLanesOnly: true,
})

function int(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return parseInt(value.trim(), 10)
  return null
}

function clamp(value: number | null, [lo, hi]: readonly [number, number], fallback: number): number {
  if (value === null) return fallback
  return Math.min(hi, Math.max(lo, value))
}

/**
 * A retry policy as stored on a node or a row → the policy the server runs,
 * or `null` when there is none (absent, `null`, or not an object — the
 * feature off). Out-of-range numbers are clamped, never refused: like a
 * rule, a half-typed value must not silently switch the retry off; the API
 * refuses out-of-range values before they are stored (its Zod), so a stored
 * value reaching the clamp is a node written by hand.
 */
export function normalizeScheduleRetry(raw: unknown): ScheduleRetry | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  return {
    afterMinutes: clamp(int(r.afterMinutes), SCHEDULE_RETRY_LIMITS.afterMinutes, SCHEDULE_RETRY_DEFAULTS.afterMinutes),
    maxAttempts: clamp(int(r.maxAttempts), SCHEDULE_RETRY_LIMITS.maxAttempts, SCHEDULE_RETRY_DEFAULTS.maxAttempts),
    // Off only when said so: the default keeps a scheduled run on the cheap lanes.
    cheapLanesOnly: r.cheapLanesOnly !== false,
  }
}

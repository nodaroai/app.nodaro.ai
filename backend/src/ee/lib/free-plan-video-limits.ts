/**
 * What the free plan states of the free-credit video limits
 * (`GET /v1/billing/plans`, readable before sign-in): the settings an account
 * on it that never paid runs under, as `freeVideoLimitsFor`
 * (free-video-limits-for.ts) hands them to it once it exists — off on a
 * deployment-payer instance, where no requester's own profile pays and the
 * limits never apply (`freeVideoLimitsApply`). A module of its own so the
 * public plans route reads it without loading the credit service.
 *
 * The plans route answers from its cache even while Stripe is down, so it must
 * not hang on the database either: past `FREE_PLAN_LIMITS_WAIT_MS` it states
 * the defaults (what the settings module falls back to on a cold cache), and
 * the read goes on behind it to warm the cache for the next answer.
 */
import { deploymentPayerActive } from "../../lib/deployment-payer.js"
import { FREE_VIDEO_LIMITS_DEFAULTS, type FreeVideoLimits } from "../billing/free-video-limits.js"
import { getFreeVideoLimits } from "./free-video-config.js"

/** The longest the plans route waits for the settings before stating the defaults. */
export const FREE_PLAN_LIMITS_WAIT_MS = 2_000

/** The free plan's video limits, as the settings read now. A fresh object every call. */
export async function freePlanVideoLimits(waitMs: number = FREE_PLAN_LIMITS_WAIT_MS): Promise<FreeVideoLimits> {
  const limits = await settingsWithin(waitMs)
  return { enabled: limits.enabled && !deploymentPayerActive(), maxSeconds: limits.maxSeconds }
}

/**
 * The settings, or the defaults when they take longer than `waitMs` (the read
 * itself is not cancelled) or fail outright. Never rejects.
 */
async function settingsWithin(waitMs: number): Promise<FreeVideoLimits> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), waitMs)
  })
  const read = getFreeVideoLimits().catch((err: unknown) => {
    console.warn("[billing] free plan video limits: the settings could not be read; stating the defaults:", err instanceof Error ? err.message : err)
    return FREE_VIDEO_LIMITS_DEFAULTS
  })
  try {
    const first = await Promise.race([read, late])
    if (first !== "late") return first
    console.warn(`[billing] free plan video limits: the settings took over ${waitMs} ms; stating the defaults`)
    return FREE_VIDEO_LIMITS_DEFAULTS
  } finally {
    clearTimeout(timer)
  }
}

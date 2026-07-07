/**
 * Cinematic Avatar (HeyGen `type:"cinematic_avatar"`) duration-clamping +
 * credit-identifier helpers. Single source of truth for the NON-monetary side
 * of cinematic-avatar billing — imported by the frontend node UI and the
 * backend route/orchestrator.
 *
 * The provider-$ rate table and the USD/credit cost FORMULAS derived from it
 * live in `backend/src/lib/pricing/cinematic-avatar-cost.ts` (core, not ee/ —
 * the HeyGen provider integration needs them regardless of edition). They
 * were moved out of this package (published Apache-2.0 on npm — an
 * irrevocable grant) per the 2026-07-06 public-flip IP audit, S5.
 *
 * ─── How this differs from ai-avatar pricing ────────────────────────────────
 * Cinematic Avatar is a generative clip (Seedance-style pipeline) driven by a
 * prompt + 1–3 avatar look ids. Crucially, `duration` is a USER PARAMETER
 * (4–15s, clamped) and is therefore KNOWN at submit time — unlike ai-avatar's
 * text/audio script whose clip length is only estimated. So the reserve here is
 * EXACT (no duration-bucket estimation): the credit id encodes the exact
 * requested duration, and the metered true-up at commit refunds nothing in the
 * common case (provider returns the requested duration).
 * ────────────────────────────────────────────────────────────────────────────
 */

export type CinematicResolution = "720p" | "1080p"

/** Minimum / maximum / default user-selectable duration (seconds). */
export const CINEMATIC_MIN_DURATION_SEC = 4
export const CINEMATIC_MAX_DURATION_SEC = 15
export const CINEMATIC_DEFAULT_DURATION_SEC = 10
export const CINEMATIC_DEFAULT_RESOLUTION: CinematicResolution = "720p"

const ALLOWED_RESOLUTIONS = new Set<CinematicResolution>(["720p", "1080p"])

/**
 * Clamp a (possibly invalid) duration to the legal 4–15s range, rounding to a
 * whole second. Falls back to the default (10s) for non-finite input.
 */
export function clampCinematicDuration(durationSec: number | undefined): number {
  const n = Number(durationSec)
  if (!Number.isFinite(n)) return CINEMATIC_DEFAULT_DURATION_SEC
  const rounded = Math.round(n)
  return Math.min(
    CINEMATIC_MAX_DURATION_SEC,
    Math.max(CINEMATIC_MIN_DURATION_SEC, rounded),
  )
}

/**
 * Composite credit identifier for an EXACT-duration reserve.
 *
 * Format: `cinematic-avatar:<resolution>:<durationSec>s`
 * e.g. `cinematic-avatar:720p:10s`.
 */
export function cinematicCreditId(
  resolution: CinematicResolution,
  durationSec: number,
): string {
  return `cinematic-avatar:${resolution}:${durationSec}s`
}

/**
 * Resolve the credit identifier from a raw request body BEFORE Zod validation.
 * Called at creditGuard preHandler time — mirrors resolveAiAvatarCreditId.
 *
 * Reads `resolution` (default 720p) and `duration` (default 10, clamped 4–15)
 * straight off the raw body. Because duration is a user parameter known at
 * submit time, the reserve id is EXACT — no bucketing.
 *
 * ─── autoDuration → reserve at the MAX-duration ceiling ──────────────────────
 * When `autoDuration` is true, the provider DROPS `duration` and HeyGen picks
 * the clip length itself, so the actual metered length is UNKNOWN at submit
 * time and can exceed the requested/default `duration`. The metered true-up at
 * commit (commit_credits) can ONLY refund a surplus — it never charges more
 * when the actual exceeds the reserved hold. Reserving under the default-10s
 * hold therefore silently undercharges any auto clip longer than 10s (a revenue
 * leak). To preserve the refund-only invariant, reserve under the MAXIMUM
 * possible hold (`cinematic-avatar:<res>:15s`) so the true-up can only refund.
 */
export function resolveCinematicCreditId(
  body: Record<string, unknown> | undefined,
): string {
  const rawResolution = body?.resolution as string | undefined
  const resolution: CinematicResolution =
    rawResolution !== undefined && ALLOWED_RESOLUTIONS.has(rawResolution as CinematicResolution)
      ? (rawResolution as CinematicResolution)
      : CINEMATIC_DEFAULT_RESOLUTION

  // autoDuration → HeyGen-chosen length, unknown at submit time → reserve at the
  // 15s ceiling so the metered true-up can only ever refund (never charge more).
  if (body?.autoDuration === true) {
    return cinematicCreditId(resolution, CINEMATIC_MAX_DURATION_SEC)
  }

  const durationSec = clampCinematicDuration(body?.duration as number | undefined)
  return cinematicCreditId(resolution, durationSec)
}

/**
 * All 24 reserve credit IDs — every (resolution × duration) combination.
 * 2 resolutions × 12 durations (4..15s) = 24.
 * Seeded in STATIC_CREDIT_COSTS and the model_pricing migration so
 * getModelCreditBaseCost never hard-fails (503 price_not_configured) for any
 * legal creditGuard input.
 */
export const CINEMATIC_RESERVE_IDS: string[] = [...ALLOWED_RESOLUTIONS].flatMap((resolution) => {
  const ids: string[] = []
  for (let d = CINEMATIC_MIN_DURATION_SEC; d <= CINEMATIC_MAX_DURATION_SEC; d++) {
    ids.push(cinematicCreditId(resolution, d))
  }
  return ids
})

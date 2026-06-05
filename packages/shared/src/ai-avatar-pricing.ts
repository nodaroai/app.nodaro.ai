/**
 * AI Avatar (HeyGen) per-second pricing helpers.
 * Single source of truth for all ai-avatar billing — imported by the backend
 * provider, the route credit-guard, and the orchestrator.
 *
 * ─── Derivation notes ───────────────────────────────────────────────────────
 * "avatar-iv" 720p is ANCHORED by a live test:
 *   9 HeyGen credits consumed for a 3.06s clip ≈ $0.0588/s
 *   [econ-intel comment removed]
 *   Rounded conservatively to $0.06/s.
 *
 *   1080p: HeyGen public info ~$4/min = $0.0667/s → rounded to $0.08/s.
 *   4K: ESTIMATE ~2× 1080p = $0.16/s (no live test yet).
 *
 * "avatar-v": ALL cells are UNPINNED ESTIMATES (premium engine, not yet
 *   tested on a paid run). Must be confirmed before avatar-v becomes default.
 *
 * ─── Ship-gate ──────────────────────────────────────────────────────────────
 * Non-720p-IV and all avatar-v cells are estimates. The `audit-credits` skill
 * + a paid Avatar-V test must confirm these values before those combinations
 * are enabled in production. Update this file and reseed the DB migration when
 * confirmed (follow the Provider Enum Sync checklist steps 7–9).
 * ────────────────────────────────────────────────────────────────────────────
 */

export type AiAvatarEngine = "avatar-v" | "avatar-iv"
export type AiAvatarResolution = "720p" | "1080p" | "4k"

/**
 * Per-second USD cost that HeyGen charges Nodaro.
 * These are PROVIDER costs — NOT Nodaro credits.
 * Credits are derived at billing time: ceil(usdCost / CREDIT_BASE_USD) with markup.
 */
export const AI_AVATAR_RATE_USD_PER_SEC: Record<AiAvatarEngine, Record<AiAvatarResolution, number>> = {
  ***REDACTED-OSS-SCRUB***
  "avatar-iv": { "720p": 0.06, "1080p": 0.08, "4k": 0.16 },
  // avatar-v: ALL UNPINNED ESTIMATES — must be confirmed before avatar-v is default.
  "avatar-v":  { "720p": 0.08, "1080p": 0.10, "4k": 0.20 },
}

/**
 * Worst-case clip duration used as the credit-reserve ceiling.
 * A 5000-character script at voiceSpeed 0.5 ≈ 5000/12/0.5 ≈ 833s → top bucket 900s.
 */
export const AI_AVATAR_MAX_DURATION_SEC = 900

/**
 * Duration buckets (seconds) used to pick a reserve ceiling at creditGuard
 * time, when the actual clip length is unknown (text-mode scripts) or only
 * known via a server-side ffprobe (audio mode).
 *
 * The low end is FINE-GRAINED (5/10/15/30/60s) so short clips — the common
 * case — don't over-reserve. A 15s clip lands in the 15s bucket, not the old
 * coarse 30s floor (which doubled the hold). The high end stays coarse because
 * long-form scripts are rare and the bucket-up is a one-time refundable surplus.
 *
 * Bucket selection:
 *   - Text mode:  bucket = pickAiAvatarBucket(ceil(scriptChars / 12 / voiceSpeed)).
 *   - Audio mode: bucket = pickAiAvatarBucket(ceil(probedDurationSec)) when the
 *     ffprobe preHandler stashed `__probedDurationSec` on the body; otherwise a
 *     MODEST 120s default (NOT the 900s top bucket — that was the bug: it
 *     reserved ~4000+ credits for a sub-minute clip).
 *
 * Worst-case derivation: 5000 chars at voiceSpeed=0.5 → ceil(5000/12/0.5) = 834s
 * → fits in 900s bucket. The 900s top bucket covers all legal text inputs.
 *
 * Note: audio >900s (no probe) would undercharge against the 120s default, but
 * the commit-time metered true-up CANNOT charge more than reserved — so a long
 * un-probed audio clip is a (small) revenue leak, not an over-charge. The probe
 * closes it for the normal path. The 900s bucket remains available for the
 * probed long-audio case.
 */
export const AI_AVATAR_DURATION_BUCKETS = [5, 10, 15, 30, 60, 120, 240, 360, 600, 900] as const

/**
 * Modest fallback bucket (seconds) for AUDIO mode when the ffprobe preHandler
 * did NOT stash a probed duration. Replaces the old 900s top-bucket fallback
 * that over-reserved ~4000+ credits for short clips. The commit-time metered
 * true-up is refund-only, so this is a reserve ceiling, not a charge.
 */
export const AI_AVATAR_AUDIO_FALLBACK_SEC = 120

/**
 * Hard cap (seconds) on AUDIO-mode clip length. HeyGen has no natural length
 * limit on an audio-driven avatar, so a long audio = an expensive / possibly
 * rejected generation and a bounded under-reserve window. We cap it here:
 *   - The worker TRIMS incoming audio longer than this down to AI_AVATAR_MAX_AUDIO_SEC
 *     (and warns the user, non-fatal).
 *   - The credit RESERVE is capped at this bucket too: even a 30-min probed
 *     audio buckets at 600s, never the 900s top bucket. Because the worker
 *     trims the actual clip to ≤600s, the metered true-up can only refund.
 *
 * Text mode (5000-char script) and cinematic (4–15s) are bounded elsewhere and
 * are NOT affected by this cap.
 */
export const AI_AVATAR_MAX_AUDIO_SEC = 600

export type AiAvatarDurationBucket = (typeof AI_AVATAR_DURATION_BUCKETS)[number]

const ALLOWED_ENGINES = new Set<AiAvatarEngine>(["avatar-v", "avatar-iv"])
const ALLOWED_RESOLUTIONS = new Set<AiAvatarResolution>(["720p", "1080p", "4k"])

/**
 * USD cost for a single ai-avatar generation.
 *
 * @param engine      HeyGen engine identifier
 * @param resolution  Output resolution
 * @param durationSec Fractional clip duration (e.g. 3.05633 → ceils to 4s)
 * @returns           Provider cost in USD, rounded to 4 decimal places
 */
export function aiAvatarUsdCost(
  engine: AiAvatarEngine,
  resolution: AiAvatarResolution,
  durationSec: number,
): number {
  const ratePerSec = AI_AVATAR_RATE_USD_PER_SEC[engine][resolution]
  const billedSecs = Math.ceil(durationSec)
  return Math.round(ratePerSec * billedSecs * 10000) / 10000
}

/**
 * Estimate script duration in seconds from character count and voice speed.
 *
 * Uses ~12 chars/sec at normal speed (voiceSpeed=1) — deliberately generous
 * (biased high) so the credit hold covers TTS pacing variations. Slower speech
 * (voiceSpeed < 1) produces a longer clip and thus a higher estimate.
 * Minimum 1s.
 *
 * @param script     Script text (undefined treated as empty).
 * @param voiceSpeed HeyGen voice speed parameter, range 0.5–1.5 (default 1).
 *                   Slower speed → more seconds → higher hold.
 */
export function estimateScriptDurationSec(script: string | undefined, voiceSpeed = 1): number {
  const speed = Math.min(1.5, Math.max(0.5, voiceSpeed || 1))
  return Math.max(1, Math.ceil((script?.length ?? 0) / 12 / speed))
}

/**
 * Pick the smallest duration bucket that is ≥ sec.
 * Falls back to the maximum bucket (900s) when sec exceeds all buckets.
 */
export function pickAiAvatarBucket(sec: number): AiAvatarDurationBucket {
  for (const b of AI_AVATAR_DURATION_BUCKETS) {
    if (sec <= b) return b
  }
  return 900
}

/**
 * Composite credit identifier for a duration-bucketed reserve.
 *
 * Format: `"heygen-<engine>:<resolution>:<bucketSec>s"`
 * e.g. `"heygen-avatar-iv:720p:60s"`.
 */
export function aiAvatarReserveCreditId(
  engine: AiAvatarEngine,
  resolution: AiAvatarResolution,
  bucketSec: number,
): string {
  return `heygen-${engine}:${resolution}:${bucketSec}s`
}

/**
 * Resolve the credit identifier from a raw request body BEFORE Zod validation.
 * Called at creditGuard preHandler time — mirrors how `resolveLipSyncIdentifier`
 * reads the raw body in `backend/src/routes/lip-sync.ts`.
 *
 * - `speechMode === "text"`: bucket by estimated script duration, accounting for
 *   voiceSpeed (slower → longer clip → larger bucket). Surplus is refunded at commit.
 * - Any other speechMode (audio / missing): bucket by `__probedDurationSec` when
 *   the ffprobe preHandler stashed it on the raw body; otherwise a MODEST 120s
 *   default (AI_AVATAR_AUDIO_FALLBACK_SEC) — NOT the 900s top bucket. Reserving
 *   the 900s ceiling for a sub-minute audio clip was the over-reservation bug
 *   (~4000+ credits held for a clip that costs ~40). The commit-time metered
 *   true-up is refund-only, so a modest reserve never over-charges. The effective
 *   seconds are ALSO capped at AI_AVATAR_MAX_AUDIO_SEC (600s) — the worker trims
 *   audio longer than that, so a 30-min audio reserves the 600s bucket, never 900s.
 *
 * - `avatarSource === "image"`: image-source mode is IV-class (HeyGen's own
 *   engine, no avatar_id) — bill at the avatar-iv rate regardless of the
 *   (ignored) `engine` field, reusing the existing heygen-avatar-iv:* ids.
 *
 * Falls back to ("avatar-iv", "720p", 120s) when fields are missing or invalid.
 */
export function resolveAiAvatarCreditId(
  body: Record<string, unknown> | undefined,
): string {
  const rawEngine = body?.engine as string | undefined
  const rawResolution = body?.resolution as string | undefined
  const speechMode = body?.speechMode as string | undefined
  const avatarSource = body?.avatarSource as string | undefined

  // Image-source mode is IV-class (its own engine, no IV/V lever) — pin the
  // rate engine to avatar-iv and reuse the existing heygen-avatar-iv:* ids.
  const engine: AiAvatarEngine =
    avatarSource === "image"
      ? "avatar-iv"
      : rawEngine !== undefined && ALLOWED_ENGINES.has(rawEngine as AiAvatarEngine)
        ? (rawEngine as AiAvatarEngine)
        : "avatar-iv"

  const resolution: AiAvatarResolution =
    rawResolution !== undefined && ALLOWED_RESOLUTIONS.has(rawResolution as AiAvatarResolution)
      ? (rawResolution as AiAvatarResolution)
      : "720p"

  let bucketSec: AiAvatarDurationBucket
  if (speechMode === "text") {
    // voiceSpeed is a float in [0.5, 1.5]; coerce to number, default 1.
    // Slower speed → more seconds → larger bucket → larger hold (no undercharge).
    const voiceSpeed = Number(body?.voiceSpeed) || 1
    bucketSec = pickAiAvatarBucket(
      estimateScriptDurationSec(body?.script as string | undefined, voiceSpeed),
    )
  } else {
    // Audio/unknown mode. The ffprobe preHandler (video-sfx pattern) stashes
    // the measured clip length on the raw body as `__probedDurationSec` so we
    // can bucket by the ACTUAL audio duration. When present, bucket by it;
    // otherwise fall back to a MODEST 120s default — NOT the 900s top bucket.
    // The old 900s fallback over-reserved ~4000+ credits for sub-minute clips.
    //
    // Effective seconds are capped at AI_AVATAR_MAX_AUDIO_SEC (600s): audio mode
    // has no natural length limit, so the worker TRIMS the actual clip to ≤600s
    // and we cap the RESERVE at the matching 600s bucket. A 30-min probed audio
    // thus reserves the 600s bucket, never the 900s top bucket. Since the worker
    // trims actual to ≤600s, the metered commit can only refund.
    const probed = Number(body?.__probedDurationSec)
    const effectiveSec = Math.min(
      Number.isFinite(probed) && probed > 0
        ? Math.ceil(probed)
        : AI_AVATAR_AUDIO_FALLBACK_SEC,
      AI_AVATAR_MAX_AUDIO_SEC,
    )
    bucketSec = pickAiAvatarBucket(effectiveSec)
  }

  return aiAvatarReserveCreditId(engine, resolution, bucketSec)
}

/**
 * All 60 reserve credit IDs — every (engine × resolution × bucket) combination.
 * 2 engines × 3 resolutions × 10 buckets (5/10/15/30/60/120/240/360/600/900s) = 60.
 * Seeded in STATIC_CREDIT_COSTS and the model_pricing migration so
 * getModelCreditBaseCost never hard-fails (503 price_not_configured) for any
 * legal creditGuard input.
 */
export const AI_AVATAR_RESERVE_IDS: string[] = (
  Object.keys(AI_AVATAR_RATE_USD_PER_SEC) as AiAvatarEngine[]
).flatMap((engine) =>
  (Object.keys(AI_AVATAR_RATE_USD_PER_SEC[engine]) as AiAvatarResolution[]).flatMap(
    (resolution) =>
      AI_AVATAR_DURATION_BUCKETS.map((bucketSec) =>
        aiAvatarReserveCreditId(engine, resolution, bucketSec),
      ),
  ),
)

/**
 * Credit hold (the STORED 0%-base reserve) for a given (engine, resolution, bucket).
 *
 * Formula: ceil(aiAvatarUsdCost(engine, resolution, bucketSec) / 0.02)
 *
 * This is the at-cost base-credit value (1 credit = $0.02, CREDIT_BASE_USD).
 * It is deliberately MINIMAL — there is NO *1.5 safety factor — because:
 *
 *   1. The admin cost-markup (~25% default) is applied to this stored value
 *      AGAIN at RESERVE time by getModelCreditCostFromDB
 *      (reserved = ceil(hold * 1.25)). Baking a second buffer here was a
 *      redundant double-markup — the user-reported over-reservation bug.
 *   2. The reserve buckets UP (true clip duration ≤ bucket ceiling), so the
 *      bucket-up alone guarantees reserved ≥ metered-actual.
 *
 * Refund-only invariant (verified by the pricing test): for every bucket at its
 * CEILING duration, reserved = ceil(hold * markup) EQUALS the metered actual
 * = ceil(ceil(usd/0.02) * markup) — they share the exact same base. For any
 * shorter clip the metered actual is strictly less. So commit_credits
 * (computeActualCredits at job completion) can only ever REFUND surplus, never
 * undercharge. No epsilon is needed — the bases are identical at the boundary.
 */
export function aiAvatarHoldCredits(
  engine: AiAvatarEngine,
  resolution: AiAvatarResolution,
  bucketSec: number,
): number {
  return Math.ceil(aiAvatarUsdCost(engine, resolution, bucketSec) / 0.02)
}

/**
 * Worst-case USD cost for a given (engine, resolution) combination.
 * Used to derive the credit ceiling seeded in STATIC_CREDIT_COSTS / DB.
 */
export function aiAvatarReserveCeilingUsd(
  engine: AiAvatarEngine,
  resolution: AiAvatarResolution,
): number {
  return aiAvatarUsdCost(engine, resolution, AI_AVATAR_MAX_DURATION_SEC)
}

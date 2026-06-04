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
 * time, when the actual clip length is unknown (text-mode scripts) or hard
 * to measure cheaply (audio mode).
 *
 * Bucket selection:
 *   - Text mode:  bucket = ceil(scriptChars / 12 / voiceSpeed), capped at 900.
 *   - Audio mode: always uses the 900s top bucket (audio duration unknown at
 *     reserve time — ffprobe pre-handler is a tracked fast-follow).
 *
 * Worst-case derivation: 5000 chars at voiceSpeed=0.5 → ceil(5000/12/0.5) = 834s
 * → fits in 900s bucket. The 900s top bucket covers all legal inputs.
 *
 * Note: audio >900s would undercharge. The proper fix is server-side ffprobe in
 * a preHandler (video-sfx pattern) — tracked as a fast-follow. For now the 900s
 * cap is the safe conservative fallback for audio mode.
 */
export const AI_AVATAR_DURATION_BUCKETS = [30, 60, 120, 240, 360, 600, 900] as const

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
 * - Any other speechMode (audio / missing): use the MAX bucket (900s) —
 *   audio duration is unknown at reserve time; metered true-up corrects the surplus.
 *
 * Falls back to ("avatar-iv", "720p", max-bucket) when fields are missing
 * or invalid.
 */
export function resolveAiAvatarCreditId(
  body: Record<string, unknown> | undefined,
): string {
  const rawEngine = body?.engine as string | undefined
  const rawResolution = body?.resolution as string | undefined
  const speechMode = body?.speechMode as string | undefined

  const engine: AiAvatarEngine =
    rawEngine !== undefined && ALLOWED_ENGINES.has(rawEngine as AiAvatarEngine)
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
    // Audio/unknown mode: reserve the top bucket (900s).
    // Audio duration is unknown at reserve time — ffprobe in a preHandler
    // (video-sfx pattern) would allow bucketing by actual length, but that's
    // a tracked fast-follow. Audio clips >900s would undercharge; for now the
    // 900s top bucket is the safe conservative ceiling.
    bucketSec = 900
  }

  return aiAvatarReserveCreditId(engine, resolution, bucketSec)
}

/**
 * All 42 reserve credit IDs — every (engine × resolution × bucket) combination.
 * 2 engines × 3 resolutions × 7 buckets (30/60/120/240/360/600/900s) = 42.
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
 * Credit hold (reserved amount) for a given (engine, resolution, bucket).
 *
 * Formula: ceil(aiAvatarUsdCost(engine, resolution, bucketSec) / 0.02 * 1.5)
 *
 * The /0.02 converts USD → base credits (1 credit = $0.02, the CREDIT_BASE_USD
 * constant). The *1.5 safety factor ensures the hold is always ≥ the actual
 * metered charge: at configured pricing factor (the default) the actual is
 * ceil(ceil(usd/0.02) * 1.25); the 1.5× buffer comfortably exceeds 1.25×.
 *
 * The actual charge is recomputed at job completion by commitJobCredits /
 * computeActualCredits from the provider's real USD cost, and commit_credits
 * refunds any surplus — so this hold is a conservative ceiling ONLY.
 */
export function aiAvatarHoldCredits(
  engine: AiAvatarEngine,
  resolution: AiAvatarResolution,
  bucketSec: number,
): number {
  return Math.ceil(aiAvatarUsdCost(engine, resolution, bucketSec) / 0.02 * 1.5)
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

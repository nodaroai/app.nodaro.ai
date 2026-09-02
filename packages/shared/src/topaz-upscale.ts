/**
 * Topaz image upscale — the single authority for "which lever did the user
 * pull, what do we send, and what do we charge".
 *
 * KIE's `topaz/image-upscale` takes exactly ONE quality lever:
 *   upscale_factor: "1" | "2" | "4"   (default "2")
 * There is no target-resolution parameter (docs.kie.ai/market/topaz/image-upscale,
 * verified 2026-09-02). The editor nevertheless shipped TWO controls — an
 * `upscaleFactor` select AND a `targetResolution` select (2K/4K/8K) — and billed
 * on the second one, which never reached the worker. Everyone who bought 4K or
 * 8K got a 2x render at 2x/4x the price (app-reports triage 2026-09-01 §4.3).
 *
 * So: the FACTOR is the lever. `targetResolution` survives only as a legacy
 * input (stored node data, old API/MCP callers) and is mapped forward here.
 * The credit tier is derived from the SAME resolution, which is why callers
 * must pass `creditTier` into `buildCreditModelIdentifier` rather than the raw
 * request value — that is what makes CHECK = DEBIT = SENT.
 *
 * The composite `topaz-image-upscale:4K` is retained as the id of the 4x tier
 * (migration 288 wrote that row; renaming it would need a pricing migration for
 * zero user-visible gain). Read it as "the top Topaz tier", not as a promise of
 * 4096 pixels. `topaz-image-upscale:8K` stays priced in STATIC_CREDIT_COSTS so
 * historical usage_logs still resolve, but nothing can reserve it any more.
 *
 * Resolution order (fix round 1, 2026-09-02 review):
 *   1. Resolve the WINNING factor first — a valid `upscaleFactor` always wins;
 *      an invalid one falls through to `targetResolution` exactly as if it had
 *      never been sent, rather than freezing the default before the legacy
 *      tier gets a chance to raise it (an invalid factor + a stored 4K/8K tier
 *      must still resolve — and bill — at the tier's factor, not the default).
 *   2. Only THEN build `adjustments`, so every `to` reflects the resolved
 *      factor rather than an intermediate guess, and every `from` is the raw,
 *      untransformed input string (never the trimmed/uppercased copy used
 *      internally to match).
 *   3. A valid `upscaleFactor` alongside a `targetResolution` it disagrees
 *      with emits an informational (not corrective) adjustment — the stored
 *      legacy choice is being overridden, not silently dropped — with
 *      `to: undefined` because nothing was actually sent for that field.
 *      Agreement (they resolve to the same factor) is reported as nothing:
 *      there is no override to disclose.
 */

export type TopazUpscaleFactor = "1" | "2" | "4"

export const TOPAZ_UPSCALE_FACTORS: readonly TopazUpscaleFactor[] = ["1", "2", "4"]

/** KIE's own default when `upscale_factor` is omitted (providers/kie/models.ts). */
export const TOPAZ_DEFAULT_UPSCALE_FACTOR: TopazUpscaleFactor = "2"

export interface TopazUpscaleAdjustment {
  field: "upscaleFactor" | "targetResolution"
  /** The raw, untransformed value as received — never trimmed or case-normalized. */
  from: string
  /**
   * The resolved factor this adjustment corresponds to, or `undefined` for the
   * informational "your stored targetResolution was overridden" notice, which
   * names nothing to switch TO — `upscaleFactor` already won.
   */
  to: string | undefined
  reason: string
}

export interface TopazUpscaleResolution {
  /** Sent to KIE as `upscale_factor`. Always set — never rely on the model default. */
  upscaleFactor: TopazUpscaleFactor
  /**
   * Passed VERBATIM as `buildCreditModelIdentifier`'s `targetResolution` arg.
   * `undefined` = the bare id (1x / 2x); `"4K"` = the 4x tier.
   */
  creditTier: "4K" | undefined
  /** Non-empty when a legacy or out-of-enum value was coerced or overridden. */
  adjustments: TopazUpscaleAdjustment[]
}

/** Legacy 2K/4K/8K tier → the factor the provider can actually deliver. */
const LEGACY_TIER_TO_FACTOR: Record<string, TopazUpscaleFactor> = {
  "2K": "2",
  "4K": "4",
  "8K": "4",
}

function isFactor(v: string): v is TopazUpscaleFactor {
  return (TOPAZ_UPSCALE_FACTORS as readonly string[]).includes(v)
}

export function resolveTopazUpscale(input: {
  upscaleFactor?: string | null
  targetResolution?: string | null
}): TopazUpscaleResolution {
  const adjustments: TopazUpscaleAdjustment[] = []

  // Raw, untransformed inputs — these are what every adjustment's `from` reports.
  const rawFactor = typeof input.upscaleFactor === "string" ? input.upscaleFactor : ""
  const rawTier = typeof input.targetResolution === "string" ? input.targetResolution : ""

  // Trimmed/normalized copies used ONLY for matching, never for display.
  const trimmedFactor = rawFactor.trim()
  const normalizedTier = rawTier.trim().toUpperCase()

  const factorGiven = trimmedFactor.length > 0
  const factorValid = factorGiven && isFactor(trimmedFactor)

  const tierGiven = normalizedTier.length > 0
  const tierMappedFactor = tierGiven ? LEGACY_TIER_TO_FACTOR[normalizedTier] : undefined

  // --- 1. Resolve the winning factor FIRST. ---
  // A valid factor always wins. An invalid (or absent) one falls through to
  // whatever the legacy tier maps to; only if that also comes up empty do we
  // land on the provider default.
  const finalFactor: TopazUpscaleFactor = factorValid
    ? (trimmedFactor as TopazUpscaleFactor)
    : (tierMappedFactor ?? TOPAZ_DEFAULT_UPSCALE_FACTOR)

  // --- 2. Emit adjustments LAST, against the already-resolved factor. ---
  if (factorGiven && !factorValid) {
    adjustments.push({
      field: "upscaleFactor",
      from: rawFactor,
      to: finalFactor,
      reason: `Topaz upscale accepts a factor of 1, 2 or 4 — "${rawFactor}" was replaced with ${finalFactor}.`,
    })
  }

  if (factorValid && tierGiven) {
    // The factor won outright. Say so if it disagrees with the stored legacy
    // tier — otherwise the tier silently vanishes with no record. Agreement
    // needs no note: nothing was overridden.
    if (tierMappedFactor !== finalFactor) {
      adjustments.push({
        field: "targetResolution",
        from: rawTier,
        to: undefined,
        reason: "upscaleFactor takes precedence over the legacy targetResolution.",
      })
    }
  } else if (!factorValid && tierGiven) {
    // No valid explicit factor — the legacy tier is the (partial) source of
    // the resolved factor, or was consulted and found unusable.
    if (tierMappedFactor) {
      if (normalizedTier === "8K") {
        adjustments.push({
          field: "targetResolution",
          from: rawTier,
          to: finalFactor,
          reason: "Topaz upscale offers factors up to 4x — an 8K target renders and bills at the 4x tier.",
        })
      }
    } else {
      adjustments.push({
        field: "targetResolution",
        from: rawTier,
        to: finalFactor,
        reason: `Unknown Topaz target "${rawTier}" — rendering at ${finalFactor}x.`,
      })
    }
  }

  return {
    upscaleFactor: finalFactor,
    creditTier: finalFactor === "4" ? "4K" : undefined,
    adjustments,
  }
}

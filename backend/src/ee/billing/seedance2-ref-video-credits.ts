import { MODEL_CATALOG, SEEDANCE_2_REF_LIMITS } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS, PriceNotConfiguredError } from "./credits.js"
import { probeMediaDuration } from "../../providers/video/ffmpeg-utils.js"

/**
 * KIE caps a Seedance 2 reference-video run's total input at ≤15s, so a probe we
 * cannot trust (rejected ffprobe, NaN/≤0 duration) is treated as the full 15s
 * worst case for that single URL — we must NEVER under-reserve, because
 * `commit_credits` only refunds a surplus and can never collect an upward delta.
 */
const REF_VIDEO_WORST_CASE_SEC = 15

/**
 * BASE (0%-markup) credit total for a Seedance 2 "with video input" reference run.
 *
 * KIE bills these runs by `unit × (input_video_duration + output_duration)`, but the
 * seeded `-ref` credit composites only encode the per-8s output rate. `commit_credits`
 * can only refund (never up-charge), so we must reserve the correct amount up front —
 * this helper scales the exact per-second base rate by the FULL billed duration
 * (sum of reference-video durations + output duration).
 *
 * The per-second base rate is derived EXACTLY from the seeded 8s `-ref` composite:
 * `perSecBase = STATIC_CREDIT_COSTS["{provider}:8s:{res}-ref"] / 8`
 * (e.g. 720p 50/8 = 6.25, 1080p 124/8 = 15.5, 4k 256/8 = 32, 480p 23/8 = 2.875).
 *
 * `resolution` is clamped to the provider's catalog resolutions (single source of
 * truth) — an unsupported tier (e.g. a stale 1080p on seedance-2-mini, which only
 * exposes 480p/720p) snaps to the model's top priced tier so the looked-up composite
 * is always seeded — mirrors `packages/shared/src/credit-identifiers.ts`.
 *
 * Hard-fail policy: throws `PriceNotConfiguredError` (the same error
 * `getModelCreditBaseCost` throws) when the clamped 8s `-ref` composite is missing.
 */
export function seedance2RefVideoBaseCredits(args: {
  provider: string
  resolution: string
  outputDurationSec: number
  inputVideoDurationSec: number
}): number {
  const { provider, resolution, outputDurationSec, inputVideoDurationSec } = args

  // Clamp the requested resolution to the provider's catalog resolutions, snapping
  // an unsupported tier to the top (last) priced tier — mirrors credit-identifiers.ts.
  const supported = MODEL_CATALOG[provider]?.resolutions ?? ["480p", "720p", "1080p"]
  const want = resolution === "4k" ? "4k" : resolution === "1080p" ? "1080p" : resolution === "720p" ? "720p" : "480p"
  const res = supported.includes(want) ? want : (supported[supported.length - 1] ?? "480p")

  const identifier = `${provider}:8s:${res}-ref`
  const composite8s = STATIC_CREDIT_COSTS[identifier]
  if (composite8s === undefined) {
    // Hard-fail: an unconfigured composite must never silently fall back to a wrong
    // (under-)reservation — matches getModelCreditBaseCost's policy.
    throw new PriceNotConfiguredError(identifier)
  }

  const perSecBase = composite8s / 8
  return Math.ceil(perSecBase * (inputVideoDurationSec + outputDurationSec))
}

/**
 * ffprobe the connected reference videos, sum their durations, and return the
 * BASE (0%-markup) credit total for the full `unit × (input + output)` Seedance 2
 * reference run. This is the SINGLE shared entry point for both the route
 * `computeCredits` hook (A2) and the orchestrator reservation (A3) — neither
 * duplicates the probe/sum/worst-case logic.
 *
 * - At most `SEEDANCE_2_REF_LIMITS.videos` URLs are probed (the route's Zod cap),
 *   so we never ffprobe an unbounded list.
 * - Probes run via `Promise.allSettled`; a rejected probe (or a NaN/≤0 duration)
 *   counts as the 15s worst case for that URL so we can only ever OVER-reserve,
 *   never under-reserve (the refund-only `commit_credits` constraint).
 * - Non-string / empty entries are ignored (they contribute 0s).
 */
export async function seedance2RefVideoBaseCreditsFromUrls(args: {
  provider: string
  resolution: string
  outputDurationSec: number
  referenceVideoUrls: readonly unknown[]
}): Promise<number> {
  const { provider, resolution, outputDurationSec, referenceVideoUrls } = args

  const candidates = referenceVideoUrls
    .slice(0, SEEDANCE_2_REF_LIMITS.videos)
    .filter((u): u is string => typeof u === "string" && u.length > 0)

  const settled = await Promise.allSettled(candidates.map((u) => probeMediaDuration(u)))
  const inputVideoDurationSec = settled.reduce((sum, r) => {
    if (r.status === "fulfilled" && Number.isFinite(r.value) && r.value > 0) return sum + r.value
    // Rejected probe OR an unusable duration → assume the full 15s worst case.
    return sum + REF_VIDEO_WORST_CASE_SEC
  }, 0)

  return seedance2RefVideoBaseCredits({ provider, resolution, outputDurationSec, inputVideoDurationSec })
}

import { buildVideoCreditModelIdentifier } from "@nodaro/shared"

/**
 * SEEDANCE_EXTEND_GENERATION_MODEL — which generation model the
 * `seedance-2-extend` provider dispatches its i2v continuation through.
 *
 * The provider id the user picks (`seedance-2-extend`) names a TRANSPORT —
 * last-frame anchor + tail reference + smart stitch — not a model. This lever
 * swaps the model underneath it: Seedance 2.5 halves the colour drift at the
 * join (measured on KIE 2026-08-29) and, with
 * `KIE_SEEDANCE_25_OUTPUT_FORMAT=mov`, lets the raw extension stay in the
 * yuv444p/PCM container so the NEXT extension can reference it un-transcoded.
 *
 * Anything but the exact string `seedance-2-5` — unset, junk, a sibling SKU
 * whose extend behaviour is unmeasured — resolves to `seedance-2`, today's
 * path. Read at call time so a Railway variable change takes effect on the
 * next job, not the next deploy.
 */
export type SeedanceExtendGenerationModel = "seedance-2" | "seedance-2-5"

export function seedanceExtendGenerationModel(): SeedanceExtendGenerationModel {
  return process.env.SEEDANCE_EXTEND_GENERATION_MODEL === "seedance-2-5" ? "seedance-2-5" : "seedance-2"
}

/**
 * Each model's NATIVE duration window. The worker snaps into it, and the
 * credit identifier below prices inside it, from the same source — an
 * extension generated outside the window a price exists for is a permanent
 * shortfall (commit_credits refunds a surplus but never collects a deficit).
 */
const DURATION_WINDOWS: Record<SeedanceExtendGenerationModel, { min: number; max: number }> = {
  "seedance-2": { min: 4, max: 15 },
  "seedance-2-5": { min: 4, max: 30 },
}

export function seedanceExtendDurationWindow(
  model: SeedanceExtendGenerationModel,
): { min: number; max: number } {
  return DURATION_WINDOWS[model]
}

/**
 * The credit identifier for one seedance extend, priced for the model the
 * worker will ACTUALLY dispatch on.
 *
 * - `seedance-2` → the historical `seedance-2-extend:<tier>:<res>` composite,
 *   whose seeded rows are the seedance-2 `-ref` matrix plus the ffmpeg stitch.
 * - `seedance-2-5` → `seedance-2-5:<Ns>:<res>-ref`. The `-ref` dimension is
 *   never optional here: this transport ALWAYS carries a reference video (the
 *   2 s tail, or the previous extension's raw mov). 2.5 is priced per second
 *   over 4–30 s, so no duration the wire allows falls off the ladder.
 *
 * There is no `seedance-2-extend` composite for 2.5, so the ~30-credit ffmpeg
 * stitch overhead the 2.0 rows carry is not billed under the lever. That is a
 * deliberate ≈4 % shortfall at 8 s/720p, taken instead of minting a new
 * identifier family (which would need its own model_pricing migration); the
 * 2.5 row is still far above the 2.0 composite it replaces.
 *
 * Used by EVERY producer of this identifier — the HTTP route's guard and
 * reservation, the workflow payload builder's reservation, and the workflow
 * estimate — so they cannot disagree about what a run costs.
 */
export function buildSeedanceExtendCreditIdentifier(
  duration: number | undefined,
  resolution: string | undefined,
): string {
  const durationSec = duration ?? 8
  const res = resolution ?? "720p"
  if (seedanceExtendGenerationModel() === "seedance-2-5") {
    return buildVideoCreditModelIdentifier(
      "seedance-2-5",
      durationSec,
      undefined,
      undefined,
      undefined,
      res,
      /* hasVideoRef */ true,
    )
  }
  return buildVideoCreditModelIdentifier(
    "seedance-2-extend",
    durationSec,
    undefined,
    undefined,
    undefined,
    res,
  )
}

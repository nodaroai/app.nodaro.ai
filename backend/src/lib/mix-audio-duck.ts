import { z } from "zod"

/**
 * Mix Audio ducking — the contract and the one place its defaults live.
 *
 * `duck.under` names the track whose level pulls every OTHER track down
 * (sidechain compression): the voice is the key, the music bed is ducked.
 * Callers say how hard with `amount` (0–100); the compressor levers stay
 * available for anyone who wants them, and the REST route, the worker, the
 * node and the MCP verb all resolve through `resolveDuck` so they cannot
 * drift apart.
 */

/** How hard the bed dips when the caller does not say (0 = not at all, 100 = hardest). */
export const DUCK_DEFAULT_AMOUNT = 75

/** Compressor levers used when the caller leaves them out. */
export const DUCK_DEFAULTS = {
  /** dBFS the key track has to exceed before the bed starts to dip — a spoken-word floor. */
  thresholdDb: -30,
  /** How fast the bed dips once speech starts. */
  attackMs: 20,
  /** How slowly it comes back up in the pauses, so a breath does not pump the bed. */
  releaseMs: 500,
} as const

/** ffmpeg's `sidechaincompress` accepts a ratio of 1–20. */
const MIN_RATIO = 1
const MAX_RATIO = 20

export const duckSchema = z
  .object({
    /** Zero-based index (in `audioUrls` order) of the key track, e.g. the voice. */
    under: z.number().int().min(0).max(19),
    /** 0–100: how much of the key's excess over the threshold comes off the other tracks. Ignored when `ratio` is given. */
    amount: z.number().min(0).max(100).optional(),
    thresholdDb: z.number().min(-60).max(0).optional(),
    ratio: z.number().min(MIN_RATIO).max(MAX_RATIO).optional(),
    attackMs: z.number().min(1).max(2000).optional(),
    releaseMs: z.number().min(10).max(9000).optional(),
  })
  .strict()

export type MixAudioDuck = z.infer<typeof duckSchema>

export type ResolvedDuck = {
  readonly under: number
  readonly thresholdDb: number
  readonly ratio: number
  readonly attackMs: number
  readonly releaseMs: number
}

/**
 * The compressor ratio for a user-facing 0–100 amount. `amount` is the share of
 * the key's excess over the threshold that is taken off the bed: a compressor
 * removes `1 − 1/ratio` of that excess, so `ratio = 1 / (1 − amount/100)` makes
 * the audible dip grow in step with the slider (a plain linear ratio would
 * spend most of the slider on the last few dB). 100 asks for infinity, so the
 * result is capped at ffmpeg's maximum of 20 (≈ 95 %).
 */
export function duckRatioFromAmount(amount: number): number {
  const a = Math.min(100, Math.max(0, amount))
  if (a >= 100) return MAX_RATIO
  const ratio = 1 / (1 - a / 100)
  return Math.round(Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)) * 100) / 100
}

export function resolveDuck(duck: MixAudioDuck): ResolvedDuck {
  return {
    under: duck.under,
    thresholdDb: duck.thresholdDb ?? DUCK_DEFAULTS.thresholdDb,
    ratio: duck.ratio ?? duckRatioFromAmount(duck.amount ?? DUCK_DEFAULT_AMOUNT),
    attackMs: duck.attackMs ?? DUCK_DEFAULTS.attackMs,
    releaseMs: duck.releaseMs ?? DUCK_DEFAULTS.releaseMs,
  }
}

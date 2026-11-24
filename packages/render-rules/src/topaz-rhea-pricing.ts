/**
 * How a Topaz Rhea video upscale (`/v1/video-upscale` with provider
 * `topaz-rhea`) is sized and priced (decided 2026-11-24).
 *
 * SIZE. Rhea takes a scale FACTOR (1–4), not a target. The run picks the
 * factor that brings the source's SHORT side to the target's (720, 1080 or
 * 2160 px): 480 → 720 is 1.5, 720 → 1080 is 1.5, 1080 → 2160 is 2. A factor
 * above 4 is sent as 4 (the output then stays below the target); a source
 * already at or above the target is refused before anything is held. The
 * output keeps the source's frame rate and length. The provider rounds the
 * output's sides its own way (a 480×854 clip at 1.5 came back 720×1284), so
 * the output is close to, not exactly, the target's frame.
 *
 * PRICE. A flat price per second of the clip, by the TARGET's size: one row
 * per target, the price of ONE second (whole credits). A run is charged the
 * row × the clip's EXACT length (decided 2026-11-24: a 4.04 s clip pays for
 * 4.04 s), rounded up ONCE to a whole credit, then marked up once by the
 * deployment's pricing settings. The length is counted in steps of 1/64 s
 * (rounded up), so it is exact in binary and the row × it is never a hair over
 * a whole credit by float noise; the smallest a clip is billed is one step,
 * which is at least one whole credit. The clip is
 * measured before anything is held and the price depends on nothing the run
 * learns later, so the hold IS the charge. The rows are admin-editable like
 * any other; a retune moves the hold, the quote and the charge together.
 */
import {
  TOPAZ_VIDEO_DEFAULT_RESOLUTION,
  TOPAZ_VIDEO_SHORT_SIDE,
  isTopazVideoResolution,
  type TopazVideoResolution,
} from "@nodaro/shared/models"
import { CONTAINER_FALLBACK_GRACE_SEC } from "./made-clip-overshoot"
import type { MeasuredFileReading } from "./video-output-length"

/** The price row of each target: the price of ONE second of the clip. */
export const TOPAZ_RHEA_CREDIT_IDS: Readonly<Record<TopazVideoResolution, string>> = {
  "720p": "topaz-rhea:720p:per-sec",
  "1080p": "topaz-rhea:1080p:per-sec",
  "4k": "topaz-rhea:4k:per-sec",
}

/** The row a run at `target` is charged a multiple of. */
export function topazRheaCreditId(target: TopazVideoResolution): string {
  return TOPAZ_RHEA_CREDIT_IDS[target]
}

/** Is `id` one of Topaz Rhea's per-second rows? */
export function isTopazRheaCreditId(id: unknown): boolean {
  return typeof id === "string" && (Object.values(TOPAZ_RHEA_CREDIT_IDS) as string[]).includes(id)
}

/**
 * The target a request's or a node's `targetResolution` runs at: one of
 * 720p / 1080p / 4k as sent, unset (or empty) = 1080p. Anything else is
 * `undefined` — the route refuses it (400), as it refuses it for Topaz.
 */
export function topazRheaTargetOf(targetResolution: unknown): TopazVideoResolution | undefined {
  if (targetResolution === undefined || targetResolution === null || targetResolution === "") return TOPAZ_VIDEO_DEFAULT_RESOLUTION
  return isTopazVideoResolution(targetResolution) ? targetResolution : undefined
}

/** The provider's factor range. */
export const TOPAZ_RHEA_MIN_FACTOR = 1
export const TOPAZ_RHEA_MAX_FACTOR = 4

/** The decimals a factor is sent with (rounded UP, so the short side never lands below the target). */
const FACTOR_SCALE = 10_000

/**
 * The factor that brings a short side of `short` px to `targetShort` px,
 * rounded UP to four decimals and NOT clamped; `undefined` when the short side
 * is already at or above the target (nothing to upscale).
 */
export function rheaFactorToShortSide(
  source: { readonly width: number; readonly height: number },
  targetShort: number,
): number | undefined {
  const short = Math.min(source.width, source.height)
  if (!(short > 0) || short >= targetShort) return undefined
  // A hair of float noise must not round a whole factor up (1080 / 540 = 2).
  return Math.ceil((targetShort / short) * FACTOR_SCALE - 1e-6) / FACTOR_SCALE
}

/**
 * The factor that brings the source's short side to the target's, rounded UP
 * to four decimals and clamped to 1–4; `undefined` when the source's short
 * side is already at or above the target's (nothing to upscale: refused).
 */
export function topazRheaUpscaleFactor(
  source: { readonly width: number; readonly height: number },
  target: TopazVideoResolution,
): number | undefined {
  const exact = rheaFactorToShortSide(source, TOPAZ_VIDEO_SHORT_SIDE[target])
  return exact === undefined ? undefined : Math.min(TOPAZ_RHEA_MAX_FACTOR, Math.max(TOPAZ_RHEA_MIN_FACTOR, exact))
}

/**
 * The frame a Rhea run must deliver for a source at a factor: each side
 * scaled and rounded, then brought DOWN to an even number (H.264 4:2:0 needs
 * even sides). The engine rounds its own way and can pad black rows below the
 * picture (480×854 at 1.5× came back 720×1284, the picture in the top 1281
 * rows); the delivery crops what it returns to this frame
 * (backend lib/topaz-rhea-delivery.ts).
 */
export function rheaExpectedFrame(
  source: { readonly width: number; readonly height: number },
  factor: number,
): { width: number; height: number } {
  const even = (n: number): number => Math.max(2, Math.floor(Math.round(n) / 2) * 2)
  return { width: even(source.width * factor), height: even(source.height * factor) }
}

/** The output frame a factor gives (each side scaled and rounded; the provider rounds its own way, within a few pixels). */
export function topazRheaOutputSize(
  source: { readonly width: number; readonly height: number },
  factor: number,
): { width: number; height: number } {
  return { width: Math.round(source.width * factor), height: Math.round(source.height * factor) }
}

/**
 * The largest output a run accepts, in gigapixels (width × height × frames).
 * The provider's throughput is not measured past one short clip (a 4 s clip to
 * 720p took 35 s end to end), so this is a provisional bound that keeps a run
 * inside the worker's wait: about 40 s at 4K 30 fps, 160 s at 1080p 30 fps,
 * 360 s at 720p 30 fps.
 */
export const TOPAZ_RHEA_MAX_OUTPUT_GIGAPIXELS = 10

/** The frame rate a source with no readable rate is counted at. */
export const TOPAZ_RHEA_FALLBACK_FPS = 30

/** The output gigapixels of a run: its output frame × the source's frames (the rate is kept). */
export function topazRheaOutputGigapixels(input: {
  readonly source: { readonly width: number; readonly height: number }
  readonly factor: number
  readonly fps?: number
  readonly durationSec: number
}): number {
  const { width, height } = topazRheaOutputSize(input.source, input.factor)
  const fps = input.fps !== undefined && Number.isFinite(input.fps) && input.fps > 0 ? input.fps : TOPAZ_RHEA_FALLBACK_FPS
  return (width * height * Math.ceil(Math.max(0, input.durationSec) * fps)) / 1e9
}

/** The longest source a run at this factor accepts, in whole seconds (under {@link TOPAZ_RHEA_MAX_OUTPUT_GIGAPIXELS}). */
export function topazRheaMaxSourceSec(input: {
  readonly source: { readonly width: number; readonly height: number }
  readonly factor: number
  readonly fps?: number
}): number {
  const { width, height } = topazRheaOutputSize(input.source, input.factor)
  const fps = input.fps !== undefined && Number.isFinite(input.fps) && input.fps > 0 ? input.fps : TOPAZ_RHEA_FALLBACK_FPS
  return Math.floor((TOPAZ_RHEA_MAX_OUTPUT_GIGAPIXELS * 1e9) / (width * height * fps))
}

/** The step a length is billed in: 1/64 s (under one frame at 60 fps), exact in binary floating point. */
export const TOPAZ_RHEA_BILLED_STEPS_PER_SEC = 64

/** Float noise: a length that is arithmetic can land a hair past a step, and must not round up for it. */
const FLOAT_NOISE_STEPS = 1e-6

/**
 * The seconds a clip of `measuredSec` is billed for, by what was measured
 * (`reading`): the video stream's length; the container's (a clip whose stream
 * length could not be read) less the made-clip allowance first
 * (`CONTAINER_FALLBACK_GRACE_SEC`). Rounded UP to a 1/64 s step, at least one
 * step. The one rounding every lane (route, quote, run estimate, workflow run)
 * reads.
 */
export function topazRheaBilledSec(measuredSec: number, reading: MeasuredFileReading = "video-stream"): number {
  const sec = reading === "container" ? measuredSec - CONTAINER_FALLBACK_GRACE_SEC : measuredSec
  const steps = Math.ceil(Math.max(0, sec) * TOPAZ_RHEA_BILLED_STEPS_PER_SEC - FLOAT_NOISE_STEPS)
  return Math.max(1, steps) / TOPAZ_RHEA_BILLED_STEPS_PER_SEC
}

/** The clip length an estimate prices when the graph does not know it (as Topaz's estimate). */
export const TOPAZ_RHEA_ESTIMATE_FALLBACK_SEC = 10

/**
 * The units (billed seconds of the target's row) an ESTIMATE quotes before the
 * clip is measured: the length the graph gives (else
 * {@link TOPAZ_RHEA_ESTIMATE_FALLBACK_SEC}), billed as a run bills it.
 */
export function topazRheaEstimateUnits(durationSec: number | null | undefined): number {
  const sec = durationSec != null && Number.isFinite(durationSec) && durationSec > 0 ? durationSec : TOPAZ_RHEA_ESTIMATE_FALLBACK_SEC
  return topazRheaBilledSec(sec)
}

/**
 * Video Depth — the one contract every layer reads: which providers exist and
 * which lane serves each, which optional levers a provider honours, how long a
 * clip may be, and which price row a run is charged from.
 *
 * Colormaps: fal renders every `VIDEO_DEPTH_COLORMAPS` entry natively. The
 * Replicate model's native output is inferno-colorized, so it offers only
 * `inferno` (passed through as-is) and `grayscale`, which a worker ffmpeg pass
 * produces from the inferno output (`videoDepthNeedsGrayscalePass`).
 *
 * Price rows are `model_pricing` rows (`<provider>:<n>s`); the credit amounts
 * live there, never here. Video Depth Anything has one row per whole second of
 * the clip, Depth Anything (per frame) one per length bucket. Worked examples
 * (repeated in docs/nodes/processing-video/video-depth.md):
 *   video-depth-anything:  0.4 s → `:1s`,  9 s → `:9s`,  9.2 s → `:10s`,  15.015 s → `:15s`,  15.06 s → `:16s`.
 *   depth-anything-frames: 5 s → `:15s`,  15 s → `:15s`,  15.015 s → `:15s`,  15.06 s → `:30s`,  61 s → `:120s`.
 */

import { pricedClipSeconds } from "./priced-clip-seconds.js"

export const VIDEO_DEPTH_PROVIDERS = ["video-depth-anything", "depth-anything-frames"] as const
export type VideoDepthProvider = (typeof VIDEO_DEPTH_PROVIDERS)[number]

export const FAL_VIDEO_DEPTH_PROVIDERS: ReadonlySet<string> = new Set(["video-depth-anything"])
export const REPLICATE_VIDEO_DEPTH_PROVIDERS: ReadonlySet<string> = new Set(["depth-anything-frames"])

/**
 * The provider a run uses: `raw` when it is a Video Depth provider, else the
 * default (the first entry). Raw workflow JSON or a FieldMapping can carry any
 * value; the dispatch, the model deny and the price row all read this one
 * resolution, so an unknown id never reaches a price row or slips the deny.
 */
export function resolveVideoDepthProvider(raw: unknown): VideoDepthProvider {
  return typeof raw === "string" && (VIDEO_DEPTH_PROVIDERS as readonly string[]).includes(raw)
    ? (raw as VideoDepthProvider)
    : VIDEO_DEPTH_PROVIDERS[0]
}

export const VIDEO_DEPTH_MODEL_SIZES = ["small", "base", "large"] as const
export type VideoDepthModelSize = (typeof VIDEO_DEPTH_MODEL_SIZES)[number]

/** The model size a run uses: `raw` when it is one, else `large` (the providers index lookup tables with it). */
export function resolveVideoDepthModelSize(raw: unknown): VideoDepthModelSize {
  return typeof raw === "string" && (VIDEO_DEPTH_MODEL_SIZES as readonly string[]).includes(raw)
    ? (raw as VideoDepthModelSize)
    : "large"
}
export const VIDEO_DEPTH_COLORMAPS = ["grayscale", "turbo", "inferno", "magma", "viridis"] as const
export type VideoDepthColormap = (typeof VIDEO_DEPTH_COLORMAPS)[number]
export const VIDEO_DEPTH_RESOLUTIONS = ["auto", "360p", "480p", "720p", "1080p"] as const
export type VideoDepthResolution = (typeof VIDEO_DEPTH_RESOLUTIONS)[number]

export type VideoDepthLever = "colormap" | "resolution" | "sideBySide"
const ALL_LEVERS: ReadonlySet<VideoDepthLever> = new Set(["colormap", "resolution", "sideBySide"])
const COLORMAP_ONLY: ReadonlySet<VideoDepthLever> = new Set(["colormap"])
const NO_LEVERS: ReadonlySet<VideoDepthLever> = new Set()

/** The optional levers `provider` honours. A lever absent here is dropped, never sent. */
export function videoDepthLevers(provider: string): ReadonlySet<VideoDepthLever> {
  if (FAL_VIDEO_DEPTH_PROVIDERS.has(provider)) return ALL_LEVERS
  if (REPLICATE_VIDEO_DEPTH_PROVIDERS.has(provider)) return COLORMAP_ONLY
  return NO_LEVERS
}

const REPLICATE_COLORMAPS: readonly VideoDepthColormap[] = ["grayscale", "inferno"]

/** The colormaps `provider` can deliver, in display order; empty when it has no colormap lever. */
export function videoDepthColormaps(provider: string): readonly VideoDepthColormap[] {
  if (FAL_VIDEO_DEPTH_PROVIDERS.has(provider)) return VIDEO_DEPTH_COLORMAPS
  if (REPLICATE_VIDEO_DEPTH_PROVIDERS.has(provider)) return REPLICATE_COLORMAPS
  return []
}

/** The colormap a run uses: the requested one when `provider` offers it, else `grayscale`; `undefined` when the provider has no colormap lever. Coerces, never throws. */
export function resolveVideoDepthColormap(provider: string, requested: unknown): VideoDepthColormap | undefined {
  if (!videoDepthLevers(provider).has("colormap")) return undefined
  const offered = videoDepthColormaps(provider)
  return typeof requested === "string" && (offered as readonly string[]).includes(requested)
    ? (requested as VideoDepthColormap)
    : "grayscale"
}

/** True when the worker must turn the Replicate model's native inferno output into grayscale with ffmpeg. */
export function videoDepthNeedsGrayscalePass(provider: string, colormap: VideoDepthColormap | undefined): boolean {
  return REPLICATE_VIDEO_DEPTH_PROVIDERS.has(provider) && resolveVideoDepthColormap(provider, colormap) === "grayscale"
}

export const VIDEO_DEPTH_LIMITS = {
  /** fal `max_frames` ceiling. */
  FAL_MAX_FRAMES: 2400,
  /** Longest clip the fal lane accepts, whatever its frame rate: its top price row, `:300s` (a low-fps clip under the frame limit can otherwise run past every price row). */
  FAL_MAX_SECONDS: 300,
  /** Frame rate assumed when the clip reports none (variable-rate or missing). */
  ASSUMED_FPS: 30,
  /** Longest clip the Replicate lane accepts. */
  REPLICATE_MAX_SECONDS: 80,
} as const

const fmt = (n: number): string => n.toLocaleString("en-US")

/** Refuse a clip the provider cannot take — run BEFORE any credit reservation. */
export function checkVideoDepthLength(
  provider: string,
  probe: { durationSec: number; fps?: number },
): { ok: true } | { ok: false; message: string } {
  if (REPLICATE_VIDEO_DEPTH_PROVIDERS.has(provider)) {
    if (probe.durationSec <= VIDEO_DEPTH_LIMITS.REPLICATE_MAX_SECONDS) return { ok: true }
    return {
      ok: false,
      message: `Video is ${Math.ceil(probe.durationSec)} s. This provider accepts at most ${VIDEO_DEPTH_LIMITS.REPLICATE_MAX_SECONDS} s.`,
    }
  }
  if (probe.durationSec > VIDEO_DEPTH_LIMITS.FAL_MAX_SECONDS) {
    return {
      ok: false,
      message: `Video is ${Math.ceil(probe.durationSec)} s. This provider accepts at most ${VIDEO_DEPTH_LIMITS.FAL_MAX_SECONDS} s. Trim the clip and run again.`,
    }
  }
  const assumed = !(typeof probe.fps === "number" && probe.fps > 0)
  const fps = assumed ? VIDEO_DEPTH_LIMITS.ASSUMED_FPS : (probe.fps as number)
  const frames = Math.ceil(probe.durationSec * fps - 1e-9)
  if (frames <= VIDEO_DEPTH_LIMITS.FAL_MAX_FRAMES) return { ok: true }
  const maxSec = Math.floor(VIDEO_DEPTH_LIMITS.FAL_MAX_FRAMES / fps)
  return {
    ok: false,
    message:
      `Video is ${fmt(frames)} frames; the limit is ${fmt(VIDEO_DEPTH_LIMITS.FAL_MAX_FRAMES)} ` +
      `(about ${maxSec} s at ${Math.round(fps)} fps${assumed ? ", assumed 30 fps because the clip reports no frame rate" : ""}). Trim the clip and run again.`,
  }
}

/** The length buckets, in seconds, the Replicate lane (Depth Anything per frame) is priced in. */
export const VIDEO_DEPTH_BUCKETS = [15, 30, 60, 120, 300] as const

/** The longest clip `provider` accepts (`checkVideoDepthLength`); the fal limit for anything else. */
function videoDepthMaxSeconds(provider: string): number {
  return REPLICATE_VIDEO_DEPTH_PROVIDERS.has(provider)
    ? VIDEO_DEPTH_LIMITS.REPLICATE_MAX_SECONDS
    : VIDEO_DEPTH_LIMITS.FAL_MAX_SECONDS
}

/**
 * The price row for a clip of `durationSec`.
 *
 * Both lanes price the clip's length rounded UP (`pricedClipSeconds`: up to
 * 0.05 s past a whole second is ignored first), so a clip under one second is
 * priced as one. The fal lane (Video Depth Anything) has one row per whole second
 * of the clip (`video-depth-anything:1s` … `:300s`, decided 2026-11-03). The
 * Replicate lane (Depth Anything per frame) has one row per length bucket
 * (`VIDEO_DEPTH_BUCKETS`, boundaries inclusive).
 *
 * Unknown, non-positive or longer than the provider accepts → the provider's
 * highest REACHABLE row: fal's longest clip (300 s → `:300s`), Replicate's
 * smallest bucket at or above its longest clip (80 s → `:120s`) — the most a
 * run on it can be charged, never a row a run could not reach.
 */
export function videoDepthCreditId(provider: string, durationSec: number | null | undefined): string {
  const maxSec = videoDepthMaxSeconds(provider)
  const known = typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0 && durationSec <= maxSec
  const priced = known ? pricedClipSeconds(durationSec) : maxSec
  if (FAL_VIDEO_DEPTH_PROVIDERS.has(provider)) return `${provider}:${priced}s`
  const top = VIDEO_DEPTH_BUCKETS[VIDEO_DEPTH_BUCKETS.length - 1]
  return `${provider}:${VIDEO_DEPTH_BUCKETS.find((b) => priced <= b) ?? top}s`
}

/**
 * Fitting a reference video to the picture a model takes (decided 2026-11-16).
 *
 * Some models take a reference video only within a window of sizes and frame
 * rates (`VIDEO_REF_VIDEO_PICTURE_LIMITS`, @nodaro/shared; Seedance 2.5 Flash:
 * 409,600–927,408 pixels, 24–60 frames a second). The provider's reference-video
 * re-encode (`reference-video-reencode.ts`) runs every clip it sends such a
 * model through {@link referenceVideoFitFilter}, so a 1080p clip, a 4K one, a
 * small one, a 23.976 fps or a 120 fps one is sent inside the window instead of
 * being refused by the provider after the run was held. Every lane goes
 * through it: a reference video on Generate Video, a Video to Video edit's
 * source, an Extend Video tail. Every other model's clip is re-encoded exactly
 * as before (no filter).
 *
 * The shape is kept (an extreme one is refused before anything is held,
 * `refVideoAspectProblem`; a picture at the very edge of the allowed shapes may
 * lose up to 2 pixels of its long side so rounding cannot push it out), and so
 * is the clip's length: a frame rate is set only for a clip with no constant
 * rate (a variable rate, as phones record) or a rate outside the window,
 * moved inside it by repeating or dropping frames over the same seconds, so
 * what a run is priced on (the clip's seconds, measured before the hold) is
 * what is sent.
 *
 * Pure: ffmpeg arguments only, no ffmpeg run.
 */
import { VIDEO_REF_VIDEO_PICTURE_LIMITS, type RefVideoPictureLimit } from "@nodaro/shared/models"
import { parseFrameRate } from "../video/frame-rate.js"

/** Odd sides cut down to even (4:2:0 needs them): the picture the size test and the scale read. */
const EVEN_CROP = "crop=trunc(iw/2)*2:trunc(ih/2)*2"

/**
 * The scale that puts a picture of the cropped sides `iw` × `ih` inside
 * [`minPixels`, `maxPixels`], in ffmpeg's own expression terms, so it is
 * evaluated on the picture as decoded (after the phone's rotation is applied
 * and the odd sides cut, whatever a probe read or could not read). Both sides
 * take one factor, √(limit ÷ pixels), so the shape is kept; a picture above the
 * window is rounded DOWN to even sides, one below it UP, so the rounding never
 * pushes it back out; one inside it is left as it is.
 * {@link fittedReferenceSize} is the same arithmetic in JavaScript, for tests.
 */
function fitScale(limit: RefVideoPictureLimit): string {
  const side = (v: "iw" | "ih") =>
    `if(gt(iw*ih\\,${limit.maxPixels})\\,trunc(${v}*sqrt(${limit.maxPixels}/(iw*ih))/2)*2\\,` +
    `if(lt(iw*ih\\,${limit.minPixels})\\,ceil(${v}*sqrt(${limit.minPixels}/(iw*ih))/2)*2\\,${v}))`
  return `scale=w=${side("iw")}:h=${side("ih")}`
}

/**
 * The scale's sides rounded each on its own can leave a picture at the very
 * edge of the allowed shapes a hair outside it (2.5:1 → 1522×608, 2.503:1).
 * This crop takes at most 2 pixels off the long side to bring it back to
 * `maxAspect` / `minAspect` (1520×608); any other picture is left as it is.
 */
function aspectCrop(limit: RefVideoPictureLimit): string {
  return (
    `crop=w=min(iw\\,trunc(ih*${limit.maxAspect}/2)*2)` +
    `:h=min(ih\\,trunc(iw*${1 / limit.minAspect}/2)*2)`
  )
}

const rateOf = (rational: string | undefined): number | undefined => {
  const fps = rational ? parseFrameRate(rational) : undefined
  return fps !== undefined && Number.isFinite(fps) && fps > 0 ? fps : undefined
}

/**
 * The frame rate a clip is set to, or undefined: its constant rate
 * (`fpsRational`), else — a variable-rate clip, as phones and screen
 * recorders make — its nominal rate (`nominalFpsRational`), held in
 * [`minFps`, `maxFps`]. Set whenever the clip has no constant rate or either
 * rate lies outside the window, which also makes the clip constant-rate; a
 * constant rate inside the window (nominal too) is kept, its frames passing
 * through as they are. A clip with neither rate readable is left as it is.
 */
export function referenceVideoFitFps(
  limit: RefVideoPictureLimit,
  probe: { readonly fpsRational?: string; readonly nominalFpsRational?: string },
): number | undefined {
  const constant = rateOf(probe.fpsRational)
  const nominal = rateOf(probe.nominalFpsRational)
  const rate = constant ?? nominal
  if (rate === undefined) return undefined
  const outside = (fps: number | undefined) => fps !== undefined && (fps < limit.minFps || fps > limit.maxFps)
  if (constant !== undefined && !outside(constant) && !outside(nominal)) return undefined
  return Math.min(limit.maxFps, Math.max(limit.minFps, rate))
}

/**
 * The `-vf` filter a clip sent to `provider` is re-encoded through, or
 * undefined for a model with no picture window (its clip is re-encoded with
 * no filter, as always). For a model with one: odd sides cut to even, the
 * picture scaled into the window ({@link fitScale}), its shape held inside the
 * model's ({@link aspectCrop}), and its frame rate set when it must be
 * ({@link referenceVideoFitFps}).
 */
export function referenceVideoFitFilter(
  provider: string,
  probe: { readonly fpsRational?: string; readonly nominalFpsRational?: string },
): string | undefined {
  const limit = VIDEO_REF_VIDEO_PICTURE_LIMITS[provider]
  if (!limit) return undefined
  const fps = referenceVideoFitFps(limit, probe)
  return [EVEN_CROP, fitScale(limit), aspectCrop(limit), ...(fps !== undefined ? [`fps=${fps}`] : [])].join(",")
}

/**
 * The size {@link referenceVideoFitFilter} gives a picture of `width` ×
 * `height` (as decoded) for `provider`: its arithmetic, step for step in the
 * same double-precision operations ffmpeg evaluates, so a test can check every
 * size lands inside the window. Undefined for a model with no window.
 */
export function fittedReferenceSize(provider: string, width: number, height: number): { width: number; height: number } | undefined {
  const limit = VIDEO_REF_VIDEO_PICTURE_LIMITS[provider]
  if (!limit) return undefined
  const iw = Math.trunc(width / 2) * 2
  const ih = Math.trunc(height / 2) * 2
  const side = (v: number): number => {
    if (iw * ih > limit.maxPixels) return Math.trunc((v * Math.sqrt(limit.maxPixels / (iw * ih))) / 2) * 2
    if (iw * ih < limit.minPixels) return Math.ceil((v * Math.sqrt(limit.minPixels / (iw * ih))) / 2) * 2
    return v
  }
  const w = side(iw)
  const h = side(ih)
  return {
    width: Math.min(w, Math.trunc((h * limit.maxAspect) / 2) * 2),
    height: Math.min(h, Math.trunc((w * (1 / limit.minAspect)) / 2) * 2),
  }
}

/**
 * The largest picture a fitted clip is encoded at, for the ffmpeg admission:
 * the window's top, as a 16:9 picture. A model with no window: undefined.
 */
export function referenceVideoFitPeakShape(provider: string): { width: number; height: number } | undefined {
  const limit = VIDEO_REF_VIDEO_PICTURE_LIMITS[provider]
  if (!limit) return undefined
  const height = Math.ceil(Math.sqrt((limit.maxPixels * 9) / 16))
  return { width: Math.ceil((height * 16) / 9), height }
}

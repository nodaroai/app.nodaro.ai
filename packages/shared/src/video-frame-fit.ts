/**
 * START/END FRAME FIT — the pure geometry half.
 *
 * WHY THIS EXISTS (measured on ~40 production renders, 2026-09-16):
 * a start frame whose pixel size is not the model's own output canvas gets
 * reshaped by the provider, and Seedance 2.5 does it VISIBLY — frame 0 is the
 * user's image verbatim, then from frame 1 the generated frames are rescaled
 * ~2% on ONE axis (x1.000 y1.02). Five of ten runs with a 940x1672 image
 * snapped; three of three with the same image resized to 720x1280 did not.
 *
 * So: reshape the frame ourselves, to the size the model was going to render
 * anyway. The canvas comes from measurement (`video-output-canvas.ts`), never
 * from arithmetic, and when a combination has never been measured the fit
 * DEGRADES rather than guesses.
 *
 * This module is pure — no I/O, no sharp, no network. `prepareVideoFrames` in
 * the backend does the pixels and the upload.
 */
import { getModel } from "./model-catalog.js"
import { resolveOutputCanvas, type VideoOutputCanvas } from "./video-output-canvas.js"

/** How much of the frame we are allowed to reshape. */
export const FRAME_FITS = ["original", "ratio", "resolution"] as const
export type FrameFit = (typeof FRAME_FITS)[number]

/** `resolution` — the measured canvas — is the default everywhere. */
export const DEFAULT_FRAME_FIT: FrameFit = "resolution"

/** How the frame is handed to the model. */
export const FRAME_DELIVERIES = ["auto", "frame", "reference"] as const
export type FrameDelivery = (typeof FRAME_DELIVERIES)[number]

export const DEFAULT_FRAME_DELIVERY: FrameDelivery = "auto"

/**
 * Stretching an image to a ratio it is nowhere near would squash the subject,
 * so past this gap the frame is centre-cropped to the target ratio FIRST and
 * only then resized. 5% covers every "1K image into a 720p canvas" case we
 * measured (940x1672 into 9:16 is a 0.05% gap) while refusing to squash a
 * square photo into 9:16 (a 78% gap).
 */
export const FRAME_FIT_STRETCH_TOLERANCE = 0.05

/**
 * Models whose frame mode is measurably worse than reference delivery.
 *
 * The Seedance 2.0 family crop-zooms the frame 2% and drifts 11-26% darker
 * within six frames in frame mode; delivered as a reference with the opening-
 * frame sentence, the same models hold a flat look from frame 0 and keep the
 * image's true geometry. Every OTHER model measured (Seedance 2.5, Gemini Omni
 * video + flash, Veo 3.1, Wan 3.0, Minimax H3) reproduces the opening frame
 * better in frame mode, so the default stays `frame` for anything absent here.
 */
export const FRAME_DELIVERY_BY_PROVIDER: Readonly<Record<string, Exclude<FrameDelivery, "auto">>> = {
  "seedance-2": "reference",
  "seedance-2-fast": "reference",
  "seedance-2-mini": "reference",
}

/** Aspect tokens that name no concrete shape — the model picks. */
const OPEN_ASPECT_TOKENS = new Set(["adaptive", "auto"])

/** `"16:9"` → 1.777…; anything unparseable → `undefined`. */
export function parseAspectToken(token: string | undefined): number | undefined {
  if (!token) return undefined
  const m = /^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/.exec(token.trim())
  if (!m) return undefined
  const w = Number(m[1]); const h = Number(m[2])
  if (!(w > 0) || !(h > 0)) return undefined
  return w / h
}

/**
 * The aspect the fit should target.
 *
 * A model whose ratios are for text-only runs (`aspectRatiosTextOnly`) gives
 * `undefined` — its frame keeps its shape. Otherwise an explicit ratio is used
 * as-is. `adaptive` / `Auto` (and an absent value,
 * which the seedance family sends as adaptive whenever a frame is present) has
 * no shape of its own: the provider will follow the IMAGE, so we snap the
 * image's own ratio to the nearest one the model lists and target that. A model
 * with no declared ratio list and an open token gives `undefined` — no fit.
 */
export function resolveFrameFitAspect(args: {
  provider: string | undefined
  requestedAspect: string | undefined
  sourceWidth: number
  sourceHeight: number
}): string | undefined {
  // A model whose ratios are for text-only runs keeps the frame's own shape
  // (catalog `aspectRatiosTextOnly`, LTX 2.5): no ratio is a crop target for
  // its frame — neither one the request still carries nor the nearest listed.
  if (args.provider && getModel(args.provider)?.aspectRatiosTextOnly === true) return undefined
  const requested = args.requestedAspect?.trim()
  if (requested && !OPEN_ASPECT_TOKENS.has(requested.toLowerCase())) return requested
  const ratios = args.provider ? getModel(args.provider)?.aspectRatios : undefined
  if (!ratios?.length || !(args.sourceWidth > 0) || !(args.sourceHeight > 0)) return undefined
  const source = args.sourceWidth / args.sourceHeight
  let best: { token: string; gap: number } | undefined
  for (const token of ratios) {
    const value = parseAspectToken(token)
    if (value === undefined) continue          // skips "adaptive"/"Auto" members
    const gap = Math.abs(Math.log(value / source))
    if (!best || gap < best.gap) best = { token, gap }
  }
  return best?.token
}

/** What `prepareVideoFrames` should do to one frame. `null` = nothing. */
export interface FrameFitPlan {
  /** Final pixel size to produce. */
  readonly width: number
  readonly height: number
  /** Centre-crop applied BEFORE the resize (only past the stretch tolerance). */
  readonly crop?: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
  /** Why the plan exists — carried into logs and job output for traceability. */
  readonly reason: "resolution" | "ratio"
}

/** Round to an even number ≥ 2 — odd dimensions break yuv420p encoders. */
function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

/**
 * The smallest change that makes `width x height` exactly `aspect`: keep the
 * longer side, move the shorter one. Rounding to even can leave a sub-pixel
 * residue, which is why the caller compares ratios with a tolerance rather than
 * for equality.
 */
export function minimalRatioDimensions(width: number, height: number, aspect: number): { width: number; height: number } {
  const current = width / height
  if (current > aspect) {
    // too wide → bring the height up (keep the long side, the width)
    return { width: even(width), height: even(width / aspect) }
  }
  return { width: even(height * aspect), height: even(height) }
}

/**
 * The centre-crop that turns `width x height` into exactly `aspect`, dropping
 * the overhang on the long axis.
 */
export function centreCropToAspect(width: number, height: number, aspect: number): { left: number; top: number; width: number; height: number } {
  const current = width / height
  if (current > aspect) {
    const w = even(height * aspect)
    return { left: Math.max(0, Math.round((width - w) / 2)), top: 0, width: Math.min(width, w), height }
  }
  const h = even(width / aspect)
  return { left: 0, top: Math.max(0, Math.round((height - h) / 2)), width, height: Math.min(height, h) }
}

/**
 * Turn a request into a concrete plan for ONE frame, or `null` when the frame
 * should be sent untouched.
 *
 * Degradation ladder — a missing measurement must never invent geometry:
 *   `resolution` with no measured canvas → behaves as `ratio`
 *   `ratio` with no resolvable aspect    → no fit
 *   any fit whose target equals the source (within a pixel) → no fit
 */
export function computeFrameFitPlan(args: {
  fit: FrameFit
  provider: string | undefined
  resolution: string | undefined
  /** The aspect as the request carries it: a ratio, `adaptive`/`Auto`, or absent. */
  aspect: string | undefined
  sourceWidth: number
  sourceHeight: number
  /** Overrides the measured table (tests, and a caller that already looked up). */
  canvas?: VideoOutputCanvas
  tolerance?: number
}): FrameFitPlan | null {
  const { fit, sourceWidth, sourceHeight } = args
  if (fit === "original") return null
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return null

  const aspectToken = resolveFrameFitAspect({
    provider: args.provider,
    requestedAspect: args.aspect,
    sourceWidth,
    sourceHeight,
  })

  const canvas = fit === "resolution"
    ? args.canvas ?? resolveOutputCanvas(args.provider, args.resolution, aspectToken)
    : undefined

  const targetAspect = canvas ? canvas[0] / canvas[1] : parseAspectToken(aspectToken)
  if (targetAspect === undefined || !(targetAspect > 0)) return null

  const sourceAspect = sourceWidth / sourceHeight
  const gap = Math.abs(sourceAspect - targetAspect) / targetAspect
  const tolerance = args.tolerance ?? FRAME_FIT_STRETCH_TOLERANCE
  const crop = gap > tolerance ? centreCropToAspect(sourceWidth, sourceHeight, targetAspect) : undefined

  const target = canvas
    ? { width: canvas[0], height: canvas[1] }
    : minimalRatioDimensions(
        crop ? crop.width : sourceWidth,
        crop ? crop.height : sourceHeight,
        targetAspect,
      )

  const unchanged = target.width === sourceWidth && target.height === sourceHeight && !crop
  if (unchanged) return null

  return {
    width: target.width,
    height: target.height,
    ...(crop ? { crop } : {}),
    reason: canvas ? "resolution" : "ratio",
  }
}

/**
 * Frame or reference? `auto` reads the per-provider default measured above.
 * Reference delivery is only possible on models that accept reference images —
 * on the others `reference` collapses back to `frame` rather than dropping the
 * frame on the floor.
 */
export function resolveFrameDelivery(args: {
  provider: string | undefined
  requested: FrameDelivery | undefined
  supportsReferenceImages: boolean
}): Exclude<FrameDelivery, "auto"> {
  const requested = args.requested ?? DEFAULT_FRAME_DELIVERY
  const wanted = requested === "auto"
    ? (args.provider ? FRAME_DELIVERY_BY_PROVIDER[args.provider] ?? "frame" : "frame")
    : requested
  if (wanted === "reference" && !args.supportsReferenceImages) return "frame"
  return wanted
}

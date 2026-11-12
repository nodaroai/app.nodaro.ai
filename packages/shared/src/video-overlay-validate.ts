/**
 * Video Overlay — the request validator: what a schema cannot express, run at
 * every engine entry. It returns a CODE, never English: `formatVideoOverlayError`
 * renders the route / worker text, the canvas renders the code through its
 * dictionaries. A sibling of `video-overlay.ts`, which it imports from; nothing
 * there imports this file.
 * Wire contract only — no prompt content, no I/O.
 */
import { OVERLAY_ANCHORS } from "./image-overlay-layers.js"
import {
  VIDEO_OVERLAY_BOUNDS, VIDEO_OVERLAY_BOX_FIELDS, VIDEO_OVERLAY_FITS, VIDEO_OVERLAY_MAX_LAYERS, VIDEO_OVERLAY_MAX_TIME_SEC,
  VIDEO_OVERLAY_MAX_VIDEO_LAYERS, VIDEO_OVERLAY_VOLUME_BOUNDS, isVideoOverlayOutputAspect, isVideoOverlayPresetId,
  type VideoOverlayBoxInput, type VideoOverlayErrorCode, type VideoOverlayLayerInput,
} from "./video-overlay.js"
import { asLayer, isFit, nonEmpty, storedLayout } from "./video-overlay-input.js"
import { isVideoOverlayVideoLayer } from "./video-overlay-video-layers.js"
import {
  VIDEO_OVERLAY_LAYOUT_IDS, isVideoOverlayLayoutId, videoOverlayLayoutNeedsAspect, videoOverlayLayoutNeedsVideoLayer, videoOverlayLayoutPlacesBase,
  type VideoOverlayLayoutId,
} from "./video-overlay-layout-ids.js"

export interface VideoOverlayIssue {
  readonly ok: false
  readonly code: VideoOverlayErrorCode
  /** 0-based index into the validated `layers[]`. */
  readonly layer?: number
  readonly slot?: number
  readonly planLayer?: number
  readonly params: Readonly<Record<string, string | number>>
}
export type VideoOverlayValidation = { readonly ok: true } | VideoOverlayIssue

export interface VideoOverlayValidationInput {
  readonly layers?: ReadonlyArray<VideoOverlayLayerInput | null | undefined> | null
  readonly outputAspect?: string | null
  readonly baseFit?: string | null
  readonly backgroundColor?: string | null
  readonly baseBox?: VideoOverlayBoxInput | null
  readonly layout?: string | null
  /** From `assembleVideoOverlayRequest`: the wired layer plan was unreadable. */
  readonly planError?: "invalid_layer_plan"
}

const inTimeRange = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= VIDEO_OVERLAY_MAX_TIME_SEC

type BoundedField = keyof typeof VIDEO_OVERLAY_BOUNDS
const BOUNDED_FIELDS = Object.keys(VIDEO_OVERLAY_BOUNDS) as BoundedField[]

/**
 * The first present (non-null) box / look field outside its domain, with the
 * domain as a symbolic `allowed` string; null when every present field is in
 * range. Only PRESENT fields are checked, so the verdict is the same before and
 * after the expansion (it fills in-range defaults only). This is what keeps a
 * JSON-written layer (MCP `update_workflow_json`, copilot, templates) from
 * reaching the geometry with an unbounded box — `drawn ≤ canvas` (§3.4) holds
 * only for boxes inside these bounds.
 */
function outOfBounds(l: VideoOverlayLayerInput): { field: string; allowed: string } | null {
  for (const f of BOUNDED_FIELDS) {
    const v = l[f]
    if (v === undefined || v === null) continue
    const [min, max] = VIDEO_OVERLAY_BOUNDS[f]
    const integer = f === "zIndex"
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
      return { field: f, allowed: `${integer ? "integers " : ""}${min}..${max}` }
    }
  }
  if (l.anchor != null && !(OVERLAY_ANCHORS as readonly unknown[]).includes(l.anchor)) {
    return { field: "anchor", allowed: OVERLAY_ANCHORS.join(", ") }
  }
  if (l.fit != null && !isFit(l.fit)) return { field: "fit", allowed: VIDEO_OVERLAY_FITS.join(", ") }
  if (l.animate != null && typeof l.animate !== "boolean") return { field: "animate", allowed: "true, false" }
  return null
}

/**
 * A present `sound` that is not `{ volume }` with the volume inside
 * `VIDEO_OVERLAY_VOLUME_BOUNDS`. Kept out of `outOfBounds`: a bad volume is
 * refused, but it does not stop the stage from drawing the layer.
 */
function soundOutOfBounds(sound: unknown): { field: string; allowed: string } | null {
  if (sound === undefined || sound === null) return null
  const [min, max] = VIDEO_OVERLAY_VOLUME_BOUNDS
  const v = typeof sound === "object" && !Array.isArray(sound) ? (sound as { volume?: unknown }).volume : undefined
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? null : { field: "sound.volume", allowed: `${min}..${max}` }
}

/** A present base box under the layer rule: anchor and width (a non-object reads as an empty box), every present box field in range. */
function baseBoxIssue(raw: unknown): VideoOverlayIssue | null {
  const own = asLayer(raw) ?? {}
  const box = Object.fromEntries(VIDEO_OVERLAY_BOX_FIELDS.map((f) => [f, own[f]])) as VideoOverlayLayerInput
  if (box.anchor == null || box.width == null) return { ok: false, code: "incomplete_box", params: { field: "baseBox" } }
  const bad = outOfBounds(box)
  return bad ? { ok: false, code: "field_out_of_bounds", params: { ...bad, field: `baseBox.${bad.field}` } } : null
}

/**
 * Can `resolveVideoOverlayGeometry` place this layer? True when its box is what
 * the validator's box checks require: `anchor` one of the nine anchors, `width`
 * a finite number, and every present box / look field in range
 * (`VIDEO_OVERLAY_BOUNDS`, enums). A partial box saved from workflow JSON
 * (`{ imageUrl, start, width }`, `anchor: null`) is stored as written — the
 * expansion leaves it for the validator's `incomplete_box` — so any reader
 * that DRAWS a stored layer (the canvas stage) must skip one that fails this;
 * the geometry would throw on it.
 */
export function hasDrawableVideoOverlayBox(layer: unknown): boolean {
  const l = asLayer(layer)
  if (!l) return false
  if (!(OVERLAY_ANCHORS as readonly unknown[]).includes(l.anchor)) return false
  if (typeof l.width !== "number" || !Number.isFinite(l.width)) return false
  return outOfBounds(l) === null
}

/**
 * Spec §3.5 — what a schema cannot express, and what the DAG path skips. Run
 * at every engine entry: the route (`.superRefine`, before the expansion), the
 * canvas single-node run, payload-builder and the worker (after it) — the
 * verdict is the same on either side of the expansion (no code reads an
 * expanded field). Also refuses a PRESENT box / look field outside
 * `VIDEO_OVERLAY_BOUNDS` or its enum / type (`field_out_of_bounds`, spec §4.4's
 * "out-of-bounds box/opacity/zIndex" row — on the DAG path this validator is
 * the only check). A layer carries an image or a video, never both
 * (`layer_two_sources`), at most `VIDEO_OVERLAY_MAX_VIDEO_LAYERS` are videos,
 * and only a video layer has `sound`. A non-object `layers[]` entry reads as
 * an empty layer. A `layout` (`""` reads as absent) must be known, a stack
 * takes no `baseBox` (`layout_conflicts_base_box`: it places the base
 * itself); a `baseBox` follows the layer rule (`incomplete_box`,
 * `field_out_of_bounds` as `baseBox.<field>`) and needs an `outputAspect`; a
 * layout gets what it needs (an aspect, a video layer) — checked before
 * `base_box_needs_aspect`, so writing a layout's base box does not change the
 * verdict. The FIRST failure, as a code.
 */
export function validateVideoOverlayRequest(body: VideoOverlayValidationInput): VideoOverlayValidation {
  if (body.planError) return { ok: false, code: "invalid_layer_plan", params: {} }
  const layers = Array.isArray(body.layers) ? body.layers : []
  if (layers.length === 0) return { ok: false, code: "no_layers", params: {} }
  if (layers.length > VIDEO_OVERLAY_MAX_LAYERS) {
    return { ok: false, code: "too_many_layers", params: { max: VIDEO_OVERLAY_MAX_LAYERS, count: layers.length } }
  }
  const videoCount = layers.filter(isVideoOverlayVideoLayer).length
  if (videoCount > VIDEO_OVERLAY_MAX_VIDEO_LAYERS) {
    return { ok: false, code: "too_many_video_layers", params: { max: VIDEO_OVERLAY_MAX_VIDEO_LAYERS, count: videoCount } }
  }
  for (let i = 0; i < layers.length; i++) {
    const l: VideoOverlayLayerInput = asLayer(layers[i]) ?? {}
    const at = (code: VideoOverlayErrorCode, params: Record<string, string | number> = {}): VideoOverlayIssue => ({
      ok: false,
      code,
      layer: i,
      ...(typeof l.slot === "number" ? { slot: l.slot } : {}),
      ...(typeof l.planLayer === "number" ? { planLayer: l.planLayer } : {}),
      params,
    })
    const boxFields = VIDEO_OVERLAY_BOX_FIELDS.filter((f) => l[f] !== undefined && l[f] !== null)
    if (!isVideoOverlayPresetId(l.preset) && boxFields.length > 0 && (l.anchor == null || l.width == null)) return at("incomplete_box")
    const bad = outOfBounds(l) ?? soundOutOfBounds(l.sound)
    if (bad) return at("field_out_of_bounds", bad)
    const hasVideo = nonEmpty(l.videoUrl)
    if (nonEmpty(l.imageUrl) && hasVideo) return at("layer_two_sources")
    if (!nonEmpty(l.imageUrl) && !hasVideo) return at("layer_without_image")
    if (l.sound != null && !hasVideo) return at("sound_without_video")
    if (!inTimeRange(l.start)) return at("time_out_of_range", { field: "start", max: VIDEO_OVERLAY_MAX_TIME_SEC })
    if (l.end !== undefined && l.end !== null) {
      if (!inTimeRange(l.end)) return at("time_out_of_range", { field: "end", max: VIDEO_OVERLAY_MAX_TIME_SEC })
      if (!(l.end > l.start)) return at("end_before_start", { start: l.start, end: l.end })
    }
  }
  const hasAspect = isVideoOverlayOutputAspect(body.outputAspect)
  if (!hasAspect && (body.baseFit != null || body.backgroundColor != null)) {
    return { ok: false, code: "fit_without_aspect", params: {} }
  }
  const stored = storedLayout(body.layout)
  if (stored !== undefined && !isVideoOverlayLayoutId(stored)) {
    return { ok: false, code: "field_out_of_bounds", params: { field: "layout", allowed: VIDEO_OVERLAY_LAYOUT_IDS.join(", ") } }
  }
  const layout = stored as VideoOverlayLayoutId | undefined
  if (layout && body.baseBox != null && videoOverlayLayoutPlacesBase(layout)) return { ok: false, code: "layout_conflicts_base_box", params: { layout } }
  const boxIssue = body.baseBox != null ? baseBoxIssue(body.baseBox) : null
  if (boxIssue) return boxIssue
  if (layout && !hasAspect && videoOverlayLayoutNeedsAspect(layout)) return { ok: false, code: "layout_needs_aspect", params: { layout } }
  if (layout && videoOverlayLayoutNeedsVideoLayer(layout) && !layers.some(isVideoOverlayVideoLayer)) {
    return { ok: false, code: "layout_needs_video_layer", params: { layout } }
  }
  if (body.baseBox != null && !hasAspect) return { ok: false, code: "base_box_needs_aspect", params: {} }
  return { ok: true }
}

const MESSAGES: { readonly [C in VideoOverlayErrorCode]: (p: Readonly<Record<string, string | number>>) => string } = {
  no_layers: () => "At least 1 layer is required",
  too_many_layers: (p) => `At most ${p.max} layers (got ${p.count})`,
  incomplete_box: (p) => (p.field ? `${p.field} needs an anchor and a width` : "anchor and width are required without a preset"),
  layer_without_image: () => "no image or video — connect one to the layer's handle or set imageUrl or videoUrl",
  time_out_of_range: (p) => `${p.field} must be between 0 and ${p.max} s`,
  end_before_start: (p) => `end (${p.end} s) must be after start (${p.start} s)`,
  fit_without_aspect: () => "baseFit and backgroundColor need an outputAspect",
  field_out_of_bounds: (p) => `${p.field} is out of range (allowed: ${p.allowed})`,
  invalid_layer_plan: () => "the layer plan must be a list of layers",
  layer_two_sources: () => "has both an image and a video — keep one (imageUrl or videoUrl)",
  too_many_video_layers: (p) => `At most ${p.max} video layers (got ${p.count})`,
  sound_without_video: () => "sound is only for a video layer — remove it or set videoUrl",
  base_box_needs_aspect: () => "baseBox needs an outputAspect",
  layout_needs_aspect: (p) => `layout ${p.layout} needs an outputAspect`,
  layout_needs_video_layer: (p) => `layout ${p.layout} needs a video layer — set videoUrl on a layer or connect a video to a layer's handle`,
  layout_conflicts_base_box: () => "A stack layout places the base itself — remove baseBox or choose Custom",
}

const PLAN_LAYER_WITHOUT_IMAGE = "no image or video — set imageUrl or videoUrl on this layer in the plan."

/** `Plan layer <n>` for a layer-plan entry, `Layer <slot>` when the layer came from the canvas, else `layers[<index>]`; "" for a request-wide failure. */
export function videoOverlayLayerLabel(ref: { readonly layer?: number; readonly slot?: number; readonly planLayer?: number }): string {
  if (typeof ref.planLayer === "number") return `Plan layer ${ref.planLayer}`
  return typeof ref.slot === "number" ? `Layer ${ref.slot}` : typeof ref.layer === "number" ? `layers[${ref.layer}]` : ""
}

/** The ONE English rendering of a verdict — the route's 400 text and the worker's error message. */
export function formatVideoOverlayError(issue: VideoOverlayIssue): string {
  const label = videoOverlayLayerLabel(issue)
  // A plan layer has no handle to connect — its source can only come from its own imageUrl or videoUrl.
  const text = issue.code === "layer_without_image" && typeof issue.planLayer === "number" ? PLAN_LAYER_WITHOUT_IMAGE : MESSAGES[issue.code](issue.params)
  return label ? `${label}: ${text}` : text
}

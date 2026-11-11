/**
 * Video Overlay — timed image and video layers over a video. The wire contract of the
 * `video-overlay` node, `POST /v1/video-overlay`, the `overlay_images` MCP
 * verb, `client.media.videoOverlay` and `nodaro media video-overlay`, defined
 * ONCE:
 *   - every numeric bound (the route schema, the validator — which refuses a
 *     present box / look field outside `VIDEO_OVERLAY_BOUNDS`, so the DAG path
 *     that never meets the route schema is bounded too — both engine
 *     assemblies and the canvas read these — never a second copy);
 *   - the placement presets, stored as data in the custom box vocabulary: a
 *     `preset` is a TAG, the box is the truth — the worker and the preview
 *     never switch on the tag;
 *   - `expandVideoOverlayLayer` / `expandVideoOverlayPresets`: the one
 *     normaliser every write boundary calls;
 *   - `resolveVideoOverlayGeometry` (in `video-overlay-geometry.ts`): the one
 *     placement function the canvas preview and the ffmpeg worker both call;
 *   - `assembleVideoOverlayRequest`: the one node-data → request assembly both
 *     workflow engines call;
 *   - `videoOverlayCompositionKey` (+ `videoOverlaySlotSources`): the freshness
 *     key a run stamps on its result (`resultCompositionKey`) — the canvas
 *     single-node Run (which sends it with the request, bounded by
 *     `VIDEO_OVERLAY_MAX_COMPOSITION_KEY_LENGTH`) and the DAG payload compute
 *     it with this one function, and the node compares it against the key of
 *     its current settings;
 *   - `validateVideoOverlayRequest` (in `video-overlay-validate.ts`): what a
 *     schema cannot express, at every engine entry. It returns a CODE, never
 *     English: `formatVideoOverlayError` renders the route / worker text, the
 *     canvas renders the code through its dictionaries.
 * The geometry and validator siblings import from this file; it imports
 * nothing from them.
 * Wire contract only — no prompt content, no I/O.
 */
import type { OverlayAnchor } from "./image-overlay-layers.js"
import { asLayer, isFit, nonEmpty, storedLayout } from "./video-overlay-input.js"
import { isVideoOverlayVideoLayer, withoutEmptyVideoOverlaySources, withoutImpliedVideoOverlayAnimate, withoutVideoOverlaySound } from "./video-overlay-video-layers.js"
import type { VideoOverlayLayoutId } from "./video-overlay-layout-ids.js"

/** Engine + MCP contract: layers per request. */
export const VIDEO_OVERLAY_MAX_LAYERS = 20
/** Ceiling for `start` / `end`, seconds. */
export const VIDEO_OVERLAY_MAX_TIME_SEC = 3600
/**
 * The canvas layer handles, index-aligned with `layers[]` (overlay → layers[0]
 * … overlay12 → layers[11]). Slots 13 and up exist in data only, via `imageUrl`.
 * The same ids Image Overlay renders.
 */
export const VIDEO_OVERLAY_HANDLE_IDS = [
  "overlay", "overlay2", "overlay3", "overlay4", "overlay5", "overlay6",
  "overlay7", "overlay8", "overlay9", "overlay10", "overlay11", "overlay12",
] as const
export const VIDEO_OVERLAY_PRESET_IDS = ["card", "corner-badge", "full-frame"] as const
export type VideoOverlayPresetId = (typeof VIDEO_OVERLAY_PRESET_IDS)[number]
export const VIDEO_OVERLAY_CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const
export type VideoOverlayCorner = (typeof VIDEO_OVERLAY_CORNERS)[number]
export const VIDEO_OVERLAY_FITS = ["contain", "cover"] as const
export type VideoOverlayFit = (typeof VIDEO_OVERLAY_FITS)[number]
/** Target aspects; absent = the base's own size and fps. */
export const VIDEO_OVERLAY_OUTPUT_ASPECTS = ["16:9", "9:16", "1:1", "4:5"] as const
export type VideoOverlayOutputAspect = (typeof VIDEO_OVERLAY_OUTPUT_ASPECTS)[number]
/**
 * Reserved input id for a JSON layer plan. Payload: `VideoOverlayLayer[]` — the
 * same shape as the node's `layers[]`, a `preset` tag allowed and expanded at
 * the boundary. It has a pip on the node; both input resolvers route an edge on
 * it into `inputs.layerPlan`, which `assembleVideoOverlayRequest` reads (plan
 * layers first, then the handle layers).
 */
export const VIDEO_OVERLAY_LAYER_PLAN_HANDLE = "layerPlan"
/** Box and look bounds. */
export const VIDEO_OVERLAY_BOUNDS = {
  x: [-100, 100],
  y: [-100, 100],
  width: [1, 100],
  height: [1, 100],
  opacity: [0, 1],
  zIndex: [0, 100],
} as const
/** Σ downloaded layer bytes per job. */
export const VIDEO_OVERLAY_MAX_TOTAL_LAYER_BYTES = 100 * 1024 * 1024
/** A video layer's `sound.volume` (1 = as recorded). */
export const VIDEO_OVERLAY_VOLUME_BOUNDS = [0, 1] as const
/**
 * Video layers per request. Measured on the pinned ffmpeg: a 60 s base with
 * two video layers renders well inside the 10-minute limit (three times its
 * slowest render), and three video layers do not at 60 s.
 */
export const VIDEO_OVERLAY_MAX_VIDEO_LAYERS = 2
/**
 * The longest base video, seconds, for a run with a video layer — the
 * longest base for which one and two video layers both render within the
 * 10-minute limit with room for three times the slowest measured render.
 */
export const VIDEO_OVERLAY_VIDEO_MAX_BASE_SEC = 60
/** One video layer's file, bytes. */
export const VIDEO_OVERLAY_MAX_LAYER_VIDEO_BYTES = 200 * 1024 * 1024
/** Fade + scale ramp, seconds each way (clamped to half of a short layer). */
export const VIDEO_OVERLAY_ANIMATION_SEC = 0.15
/** The scale a layer grows from and shrinks back to during the ramp. */
export const VIDEO_OVERLAY_ANIMATION_MIN_SCALE = 0.96
/** Corner-badge width and inset, % of the output canvas. */
export const VIDEO_OVERLAY_BADGE_WIDTH = 18
export const VIDEO_OVERLAY_BADGE_INSET = 4
/** Pad colour for `baseFit: "contain"` when none is given. */
export const VIDEO_OVERLAY_DEFAULT_BACKGROUND = "#000000"
/** The six box fields — exactly what a preset writes. */
export const VIDEO_OVERLAY_BOX_FIELDS = ["anchor", "x", "y", "width", "height", "fit"] as const
export const VIDEO_OVERLAY_WARNING_CODES = ["clipped", "skipped", "animated_first_frame", "audio_reencoded", "layer_no_audio"] as const
export type VideoOverlayWarningCode = (typeof VIDEO_OVERLAY_WARNING_CODES)[number]
export const VIDEO_OVERLAY_ERROR_CODES = [
  "no_layers", "too_many_layers", "incomplete_box", "layer_without_image",
  "time_out_of_range", "end_before_start", "fit_without_aspect", "field_out_of_bounds", "invalid_layer_plan",
  "layer_two_sources", "too_many_video_layers", "sound_without_video",
  "base_box_needs_aspect", "layout_needs_aspect", "layout_needs_video_layer", "layout_conflicts_base_box",
] as const
export type VideoOverlayErrorCode = (typeof VIDEO_OVERLAY_ERROR_CODES)[number]

export interface VideoOverlayBox {
  readonly anchor: OverlayAnchor
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height?: number
  readonly fit: VideoOverlayFit
}
/** A box as a writer may send it (the base box from workflow JSON): every field optional; `null` means absent. */
export type VideoOverlayBoxInput = { readonly [K in keyof VideoOverlayBox]?: VideoOverlayBox[K] | null }

/** A video layer's sound, mixed with the base's during the layer's window. Absent = the layer is silent. */
export interface VideoOverlaySound {
  /** 0..1 (`VIDEO_OVERLAY_VOLUME_BOUNDS`). */
  readonly volume: number
}

/** A layer as stored and enqueued — complete: every box and look field present. */
export interface VideoOverlayLayer {
  /**
   * Used when the layer's canvas handle is not wired (MCP, template, layers
   * 13 and up). Wiring the handle CLEARS it — on the canvas by the one `layers[]`
   * writer (D3), on JSON-written workflows by the write-boundary pass (D10) —
   * and the run-time merge is still `wired ?? imageUrl` everywhere.
   */
  imageUrl?: string
  /**
   * The layer's video, instead of `imageUrl` — never both. Cleared by wiring
   * exactly as `imageUrl` is; a wired handle's source is a video when the
   * assembly is told so (`wiredVideoSlots`).
   */
  videoUrl?: string
  /** A video layer only. */
  sound?: VideoOverlaySound
  /** 1-based canvas slot (overlay = 1 … overlay12 = 12; 13 and up handle-less), stamped by both engine assemblies. Messages prefer it. */
  slot?: number
  /** 1-based entry of a wired layer plan, stamped by the assembly. Messages prefer it. */
  planLayer?: number
  /** Seconds, 0..3600, stored ms-precise; rendered on the base's frame grid (±1 frame). */
  start: number
  /** Seconds, 0..3600, > start; absent = until the video ends. */
  end?: number
  /** A TAG only — the box below is the truth. */
  preset?: VideoOverlayPresetId
  /** corner-badge only; default bottom-right. */
  corner?: VideoOverlayCorner
  anchor: OverlayAnchor
  /** Offset from the anchor, % of the output canvas width (−100..100; negative on a right anchor = inward). */
  x: number
  /** Offset from the anchor, % of the output canvas height. */
  y: number
  /** % of the output canvas width (1..100). */
  width: number
  /** % of the output canvas height (1..100); absent = follows the image's (or video's) aspect. */
  height?: number
  fit: VideoOverlayFit
  /** 0..1 */
  opacity: number
  /** Fade + slight scale in and out, 0.15 s each way. Default on for an image, off for a video. */
  animate: boolean
  /** Integer 0..100; absent = its position (slot − 1: layer 1 lowest). */
  zIndex?: number
}

/** A layer as a WRITER may send it (workflow JSON, a template, the canvas): every field optional; `null` means absent. */
export type VideoOverlayLayerInput = { [K in keyof VideoOverlayLayer]?: VideoOverlayLayer[K] | null }

/**
 * A layer on the REST / SDK wire: exactly one of `imageUrl` / `videoUrl`, and
 * `start`, required; the box may be a preset, explicit fields, or nothing
 * (→ the corner-badge default).
 */
export type VideoOverlayLayerSpec = { start: number } & Partial<Omit<VideoOverlayLayer, "imageUrl" | "videoUrl" | "start">> &
  ({ imageUrl: string; videoUrl?: never } | { videoUrl: string; imageUrl?: never })

/**
 * A base box on the REST / SDK wire: `anchor` and `width` required; `x` and
 * `y` default to 0 and `fit` to contain (`expandVideoOverlayLayout`), and no
 * `height` follows the base's own aspect.
 */
export type VideoOverlayBaseBoxSpec = Pick<VideoOverlayBox, "anchor" | "width"> & Partial<Omit<VideoOverlayBox, "anchor" | "width">>

/** The `POST /v1/video-overlay` body. */
export interface VideoOverlayRequest {
  videoUrl: string
  /** 1..20, at most `VIDEO_OVERLAY_MAX_VIDEO_LAYERS` (2) of them videos. */
  layers: VideoOverlayLayerSpec[]
  outputAspect?: VideoOverlayOutputAspect
  /** Only with `outputAspect`; default cover. */
  baseFit?: VideoOverlayFit
  /** `#rrggbb`, only with `outputAspect` (drawn under `contain`); default `#000000`. */
  backgroundColor?: string
  /** Where the base sits, in a layer's box vocabulary; only with `outputAspect`. Overrides `baseFit`; uncovered canvas shows `backgroundColor`. Refused with a stack layout. */
  baseBox?: VideoOverlayBaseBoxSpec
  /**
   * A named layout that writes the boxes (`expandVideoOverlayLayout`): an
   * explicit `baseBox` wins over `video-bottom` / `video-top`; a stack places
   * the base itself and takes none; `pip` replaces the first video layer's box.
   */
  layout?: VideoOverlayLayoutId
}

/** A request whose layers went through `expandVideoOverlayPresets`. */
export interface ExpandedVideoOverlayRequest extends Omit<VideoOverlayRequest, "layers" | "baseBox"> {
  layers: VideoOverlayLayer[]
  /**
   * The base box as stored or sent, its `null` fields dropped — any field may
   * be absent. The validator refuses one without an anchor and a width; the
   * worker fills the rest (`expandVideoOverlayLayout`) after it.
   */
  baseBox?: Partial<VideoOverlayBox>
  /** Set by the assembly when a wired layer plan could not be read; `validateVideoOverlayRequest` reports it first. */
  planError?: "invalid_layer_plan"
}

/** `output_data.warnings[]`: `layer` = 0-based index of the request's layers (absent for a render-wide warning such as `audio_reencoded`), `slot` when known. */
export interface VideoOverlayWarning {
  readonly layer?: number
  readonly slot?: number
  /** Set instead of `slot` when the layer came from the layer plan. */
  readonly planLayer?: number
  readonly code: VideoOverlayWarningCode
  readonly detail: string
}

const badge = (anchor: VideoOverlayCorner, sx: 1 | -1, sy: 1 | -1): VideoOverlayBox => ({
  anchor,
  x: sx * VIDEO_OVERLAY_BADGE_INSET,
  y: sy * VIDEO_OVERLAY_BADGE_INSET,
  width: VIDEO_OVERLAY_BADGE_WIDTH,
  fit: "contain",
})

/**
 * Placement presets as DATA in the custom vocabulary. `card` sits centred, 4 %
 * above centre, contain into 78 % × 60 % of the frame; `full-frame` covers the
 * frame; `corner-badge` is 18 % wide, 4 % in from its corner.
 */
export const VIDEO_OVERLAY_PRESETS: {
  readonly card: VideoOverlayBox
  readonly "full-frame": VideoOverlayBox
  readonly "corner-badge": Readonly<Record<VideoOverlayCorner, VideoOverlayBox>>
} = {
  card: { anchor: "center", x: 0, y: -4, width: 78, height: 60, fit: "contain" },
  "full-frame": { anchor: "center", x: 0, y: 0, width: 100, height: 100, fit: "cover" },
  "corner-badge": {
    "bottom-right": badge("bottom-right", -1, -1),
    "bottom-left": badge("bottom-left", 1, -1),
    "top-right": badge("top-right", -1, 1),
    "top-left": badge("top-left", 1, 1),
  },
}

/** D2 — what a wired slot with no settings runs (and previews) with: the bottom-right corner badge, from 0 to the end. */
export const DEFAULT_VIDEO_OVERLAY_LAYER: VideoOverlayLayer = Object.freeze({
  start: 0,
  preset: "corner-badge" as const,
  corner: "bottom-right" as const,
  ...VIDEO_OVERLAY_PRESETS["corner-badge"]["bottom-right"],
  opacity: 1,
  animate: true,
})

const HEX6 = /^#[0-9a-fA-F]{6}$/

export function isVideoOverlayPresetId(v: unknown): v is VideoOverlayPresetId {
  return typeof v === "string" && (VIDEO_OVERLAY_PRESET_IDS as readonly string[]).includes(v)
}
export function isVideoOverlayCorner(v: unknown): v is VideoOverlayCorner {
  return typeof v === "string" && (VIDEO_OVERLAY_CORNERS as readonly string[]).includes(v)
}
export function isVideoOverlayOutputAspect(v: unknown): v is VideoOverlayOutputAspect {
  return typeof v === "string" && (VIDEO_OVERLAY_OUTPUT_ASPECTS as readonly string[]).includes(v)
}
/** 1-based slot of a layer handle id (`overlay` → 1 … `overlay12` → 12); 0 for anything else. */
export function videoOverlaySlotOfHandle(handle: string | null | undefined): number {
  return (VIDEO_OVERLAY_HANDLE_IDS as readonly string[]).indexOf(handle ?? "") + 1
}

export function videoOverlayPresetBox(preset: VideoOverlayPresetId, corner?: VideoOverlayCorner | null): VideoOverlayBox {
  return preset === "corner-badge"
    ? VIDEO_OVERLAY_PRESETS["corner-badge"][isVideoOverlayCorner(corner) ? corner : "bottom-right"]
    : VIDEO_OVERLAY_PRESETS[preset]
}

/** Filled when absent; `animate` too, by the layer's kind (on for an image, off for a video). */
const TRAILING_DEFAULTS = { x: 0, y: 0, fit: "contain", opacity: 1 } as const

function usable(key: string, value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (key === "preset") return isVideoOverlayPresetId(value)
  if (key === "corner") return isVideoOverlayCorner(value)
  return true
}

/** `null` / `undefined` / an unknown preset or corner → absent. By reference when nothing is dropped. */
function clean(raw: VideoOverlayLayerInput): Partial<VideoOverlayLayer> {
  const entries = Object.entries(raw)
  if (entries.every(([k, v]) => usable(k, v))) return raw as Partial<VideoOverlayLayer>
  return Object.fromEntries(entries.filter(([k, v]) => usable(k, v))) as Partial<VideoOverlayLayer>
}

function sameShallow(a: Readonly<Record<string, unknown>>, b: unknown): boolean {
  if (!b || typeof b !== "object") return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => a[k] === (b as Record<string, unknown>)[k])
}

/**
 * The ONE normaliser (spec §3.3), called at every write boundary.
 * - `preset` + no box field → the preset's box is copied in, the tag stays.
 * - `preset` + explicit box fields → explicit fields win, the preset fills
 *   what is absent; the tag is cleared only when an explicit field DIFFERS
 *   from the preset's box (a field the preset does not set — `height` on a
 *   corner badge — differs when present).
 * - no `preset` + no box field → the corner badge of the layer's own `corner`
 *   (bottom-right when none), the D2 default filling tag / corner / trailing
 *   fields, the layer's own fields winning (D8): `{}` → the full default.
 * - no `preset` + a PARTIAL box (not anchor AND width) → returned untouched;
 *   the validator answers `incomplete_box`.
 * Trailing defaults x 0, y 0, fit contain, opacity 1, and animate (true for an
 * image, false for a video layer — in every branch, the default layer's included)
 * are filled here and nowhere else. A VIDEO layer with a preset and no `start`
 * starts at 0, like the default layer; an image one is left to the validator
 * (`time_out_of_range`), as it always was. `null` reads as absent. Returned BY
 * REFERENCE when nothing changes; idempotent, tag included.
 */
export function expandVideoOverlayLayer(raw: VideoOverlayLayerInput | null | undefined): VideoOverlayLayer {
  const obj = asLayer(raw)
  const layer = obj ? clean(obj) : {}
  const animateDefault = !isVideoOverlayVideoLayer(layer)
  const present = VIDEO_OVERLAY_BOX_FIELDS.filter((f) => layer[f] !== undefined)
  let out: Record<string, unknown>
  if (isVideoOverlayPresetId(layer.preset)) {
    const box = videoOverlayPresetBox(layer.preset, layer.corner)
    // A video layer tagged with a preset starts at 0 when it names no start (as the default layer does); an image layer is left for the validator, as before.
    out = { ...box, ...(animateDefault || layer.start !== undefined ? {} : { start: 0 }), ...layer }
    if (present.some((f) => layer[f] !== box[f])) delete out.preset
  } else if (present.length === 0) {
    out = { ...DEFAULT_VIDEO_OVERLAY_LAYER, animate: animateDefault, ...videoOverlayPresetBox("corner-badge", layer.corner), ...layer }
  } else if (layer.anchor === undefined || layer.width === undefined) {
    return raw as VideoOverlayLayer
  } else {
    out = { ...layer }
  }
  for (const [k, v] of Object.entries(TRAILING_DEFAULTS)) if (out[k] === undefined) out[k] = v
  if (out.animate === undefined) out.animate = animateDefault
  return sameShallow(out, raw) ? (raw as VideoOverlayLayer) : (out as unknown as VideoOverlayLayer)
}

/** `expandVideoOverlayLayer` over an array; the SAME array when no layer changed. */
export function expandVideoOverlayPresets(layers: ReadonlyArray<VideoOverlayLayerInput | null | undefined>): VideoOverlayLayer[] {
  let changed = false
  const out = layers.map((l) => {
    const e = expandVideoOverlayLayer(l)
    if (e !== l) changed = true
    return e
  })
  return changed ? out : (layers as VideoOverlayLayer[])
}

/** The panel's preset click: REPLACE the six box fields with the preset's (dropping any it does not set), set the tag (+ corner), expand. */
export function applyVideoOverlayPreset(
  layer: VideoOverlayLayerInput | null | undefined,
  preset: VideoOverlayPresetId,
  corner?: VideoOverlayCorner,
): VideoOverlayLayer {
  const base: Record<string, unknown> = { ...expandVideoOverlayLayer(layer) }
  for (const f of VIDEO_OVERLAY_BOX_FIELDS) delete base[f]
  delete base.preset
  const nextCorner = preset === "corner-badge" ? (corner ?? (isVideoOverlayCorner(base.corner) ? base.corner : "bottom-right")) : undefined
  return expandVideoOverlayLayer({
    ...base,
    ...videoOverlayPresetBox(preset, nextCorner),
    preset,
    ...(nextCorner ? { corner: nextCorner } : {}),
  } as VideoOverlayLayerInput)
}

/** The panel's "Custom": the tag is cleared, the box kept. */
export function toCustomVideoOverlayLayer(layer: VideoOverlayLayerInput | null | undefined): VideoOverlayLayer {
  const { preset: _tag, ...rest } = expandVideoOverlayLayer(layer)
  return rest as VideoOverlayLayer
}

/**
 * D10 — delete `imageUrl` AND `videoUrl` from every layer whose canvas handle
 * is wired (`wiredSlots`: 1-based): the wire is the layer's source, whichever
 * kind it is. Pure over `layers` (the route has no edges, so this is a sibling
 * of the expansion, not part of it). Slots 13 and up have no handle and are
 * never touched. The input array by reference when nothing changes.
 */
export function clearWiredVideoOverlayImageUrls<T extends VideoOverlayLayerInput | null | undefined>(
  layers: readonly T[],
  wiredSlots: ReadonlySet<number>,
): readonly T[] {
  let out: T[] | null = null
  for (const slot of wiredSlots) {
    if (!Number.isInteger(slot) || slot < 1 || slot > VIDEO_OVERLAY_HANDLE_IDS.length) continue
    const layer = layers[slot - 1]
    if (!asLayer(layer) || !("imageUrl" in (layer as object) || "videoUrl" in (layer as object))) continue
    out ??= [...layers]
    const { imageUrl: _image, videoUrl: _video, ...rest } = layer as VideoOverlayLayerInput
    out[slot - 1] = rest as T
  }
  return out ?? layers
}

interface NodeLike {
  id?: unknown
  type?: unknown
  data?: unknown
}
interface EdgeLike {
  target?: unknown
  targetHandle?: unknown
}

/**
 * The workflow-JSON write-boundary pass (spec §3.3, D10), beside
 * `normalizeNodeModelParams`: for every `video-overlay` node, clear the
 * `imageUrl` of each layer whose handle the WRITTEN edges wire, then expand
 * presets. Runs on every write, so an edge-only write still clears. A `null`
 * (or missing) slot STAYS `null`: "no settings" is stored as such, wired or
 * not — the default corner badge is synthesised only where a wired slot is
 * run or drawn (the two engine assemblies and the stage, D2), so the panel,
 * the reorder and the tail trim see the same empty slot whichever writer
 * stored it. (`{}` is not `null`: it is an explicit empty layer, and the
 * expansion turns it into the full default — spec §3.3.) Nodes and the array
 * are returned by reference when nothing changes.
 */
export function normalizeVideoOverlayNodes<T extends NodeLike>(nodes: readonly T[], edges: ReadonlyArray<EdgeLike> | null | undefined): T[] {
  let changed = false
  const out = nodes.map((node) => {
    if (node.type !== "video-overlay") return node
    const data = node.data
    if (!data || typeof data !== "object" || Array.isArray(data)) return node
    const d = data as Record<string, unknown>
    if (!Array.isArray(d.layers)) return node
    const layers = d.layers as Array<VideoOverlayLayerInput | null>
    const wired = new Set<number>()
    for (const e of edges ?? []) {
      if (e.target !== node.id) continue
      const slot = videoOverlaySlotOfHandle(typeof e.targetHandle === "string" ? e.targetHandle : undefined)
      if (slot > 0) wired.add(slot)
    }
    const cleared = clearWiredVideoOverlayImageUrls(layers, wired)
    let layersChanged = cleared !== layers
    const next = cleared.map((l, i) => {
      // null / missing stays as stored; a non-object entry is left untouched so
      // the validator sees it (it reads as an absent layer everywhere).
      if (!asLayer(l)) return l
      // A wired slot's fade default follows its wire's kind, read at the run:
      // only a fade it was written with is stored.
      const expanded = expandVideoOverlayLayer(l)
      const e = wired.has(i + 1) ? withoutImpliedVideoOverlayAnimate(expanded, l) : expanded
      if (e !== l) layersChanged = true
      return e
    })
    if (!layersChanged) return node
    changed = true
    return { ...node, data: { ...d, layers: next } }
  })
  return changed ? out : (nodes as T[])
}

/** What `videoOverlayRenderOrder` reads from a layer. */
export interface VideoOverlayOrderable {
  readonly zIndex?: number | null
  /** 1-based canvas slot (stamped by both engine assemblies). */
  readonly slot?: number | null
  /** 1-based layer-plan entry. Plan layers sit BELOW every slot layer (handle layers draw above the plan), unless they set a `zIndex`. */
  readonly planLayer?: number | null
  /** 0-based index in the request's `layers[]` (the worker's graph layers carry it). */
  readonly index?: number | null
}

/** A plan layer's default position sits this far below layer 1's (slot 1 = 0), so the whole plan renders under the slot layers. */
const PLAN_LAYER_Z_BASE = 1000
const isSlot = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1
const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0

/**
 * Render order, bottom to top, as positions in `layers`: an explicit zIndex
 * wins; a layer without one sits at its OWN position — `slot − 1` when it has
 * a slot, else its request `index`, else its position in the array given —
 * never at its position in whatever (compacted) array it happens to be passed
 * in. The stage passes every slot; the worker passes the request minus empty
 * slots and minus layers skipped for starting after the end — both must agree
 * (spec: the preview and the run use the same numbers). Ties keep array order
 * (layer 1 lowest).
 */
export function videoOverlayRenderOrder(layers: ReadonlyArray<VideoOverlayOrderable | null | undefined>): number[] {
  return layers
    .map((l, i) => {
      const own = isSlot(l?.planLayer) ? l.planLayer - 1 - PLAN_LAYER_Z_BASE : isSlot(l?.slot) ? l.slot - 1 : isIndex(l?.index) ? l.index : i
      return { i, z: typeof l?.zIndex === "number" && Number.isFinite(l.zIndex) ? l.zIndex : own }
    })
    .sort((a, b) => a.z - b.z || a.i - b.i)
    .map((e) => e.i)
}

/** The wired `layerPlan` value (a JSON string or an array) → its layers, or `invalid_layer_plan`. */
export function parseVideoOverlayLayerPlan(raw: unknown): { layers: VideoOverlayLayerInput[] } | { error: "invalid_layer_plan" } {
  let value: unknown = raw
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw)
    } catch {
      return { error: "invalid_layer_plan" }
    }
  }
  if (!Array.isArray(value) || !value.every((l) => l !== null && typeof l === "object" && !Array.isArray(l))) {
    return { error: "invalid_layer_plan" }
  }
  return { layers: value as VideoOverlayLayerInput[] }
}

/** A stored base box without its `null` fields (by reference when it has none); a non-object as stored, for the validator. */
const storedBaseBox = (box: VideoOverlayBoxInput): Partial<VideoOverlayBox> => (asLayer(box) ? clean(box as VideoOverlayLayerInput) : box) as Partial<VideoOverlayBox>

/** The node-data fields the assembly reads. */
export interface VideoOverlayNodeFields {
  readonly layers?: ReadonlyArray<VideoOverlayLayerInput | null | undefined> | null
  readonly outputAspect?: string | null
  readonly baseFit?: string | null
  readonly backgroundColor?: string | null
  /** As written, like the fields above: the validator, not the type, refuses a malformed box or an unknown layout. */
  readonly baseBox?: VideoOverlayBoxInput | null
  readonly layout?: string | null
}

/**
 * The ONE node → request assembly, called by the canvas single-node run AND
 * payload-builder (so both engines refuse identically). Per slot i over
 * max(wired handles (≤ 12), stored layers) — every stored slot, so more than
 * 20 layers that render reach the validator's `too_many_layers` instead of
 * being dropped: the source is the wired handle's — a `videoUrl` when its slot
 * is in `wiredVideoSlots`, else an `imageUrl` (a stored `sound` skipped, so a
 * wire read as an image at the run never refuses it), replacing both stored
 * sources — else the layer's own `imageUrl` / `videoUrl` as stored (both stored reach
 * the validator's `layer_two_sources`; an empty-string one is dropped —
 * `withoutEmptyVideoOverlaySources`, plan layers too); a slot with neither is dropped; a slot with
 * no settings is the default layer (D2 — a `null` / missing / `{}` entry);
 * `slot = i + 1` is stamped; the layer is expanded. `baseFit` /
 * `backgroundColor` ride as stored, WITH or WITHOUT an `outputAspect`: the
 * validator — not this assembly — refuses them without one
 * (`fit_without_aspect`, spec §3.5), so a JSON-written node carrying a fit
 * and no aspect is refused on both engines instead of silently rendering.
 * (The canvas never builds that request: its two aspect writers clear both
 * fields with the aspect.) A value the route's schema would reject — an
 * unknown aspect or fit, a colour that is not `#rrggbb` — is dropped here.
 * `baseBox` and `layout` ride AS STORED (a `""` layout reads as absent, like
 * `null`; a box's `null` fields are dropped, as a layer's are by its
 * expansion — every reader treats them as absent, and the REST route's schema
 * takes no `null`, so the canvas run's request stays one the route accepts): a
 * malformed box or an unknown layout reaches the validator, which refuses it
 * on both engines.
 *
 * A wired layer plan (`planLayers`, a JSON string or an array) contributes its
 * layers FIRST, then the slot layers: plan layers carry `planLayer` (1-based)
 * and never a `slot`, and a plan layer's image is only its own `imageUrl` —
 * never the index-aligned handle's (R18). An unreadable plan sets `planError`,
 * which the validator reports before anything else.
 */
export function assembleVideoOverlayRequest(input: {
  readonly videoUrl: string
  readonly data: VideoOverlayNodeFields
  /** Each wired handle's source, by slot (images and videos alike). */
  readonly wiredImageUrls: ReadonlyArray<string | null | undefined>
  /** 1-based slots whose wired source is a video (`videoOverlayWiredLayerKind`); absent = every wire is an image. */
  readonly wiredVideoSlots?: ReadonlySet<number>
  /** The wired `layerPlan` value (string or array); absent when nothing is wired. */
  readonly planLayers?: unknown
}): ExpandedVideoOverlayRequest {
  const stored = Array.isArray(input.data.layers) ? input.data.layers : []
  const wired = input.wiredImageUrls.slice(0, VIDEO_OVERLAY_HANDLE_IDS.length)
  // Every stored slot, never capped at VIDEO_OVERLAY_MAX_LAYERS: a JSON-written
  // node with 21+ layers must reach the validator's `too_many_layers` on both
  // engines (spec §3.5) — capping here would silently drop layers 21+. Only the
  // wired list is capped (12 handles).
  const slots = Math.max(wired.length, stored.length)
  const layers: VideoOverlayLayer[] = []
  for (let i = 0; i < slots; i++) {
    const own = asLayer(stored[i])
    const raw = own && withoutEmptyVideoOverlaySources(own)
    const wiredUrl = wired[i]
    if (nonEmpty(wiredUrl)) {
      // The wire is the source: the other kind's stored field goes, its own kind's is replaced.
      const video = input.wiredVideoSlots?.has(i + 1) === true
      const [kind, other] = video ? (["videoUrl", "imageUrl"] as const) : (["imageUrl", "videoUrl"] as const)
      const { [other]: _replaced, ...keep } = raw ?? {}
      // An image wire skips a stored sound (`withoutVideoOverlaySound`); the expansion fills the fade default by the wire's kind.
      layers.push(expandVideoOverlayLayer({ ...(video ? keep : withoutVideoOverlaySound(keep)), [kind]: wiredUrl, slot: i + 1 }))
    } else if (nonEmpty(raw?.imageUrl) || nonEmpty(raw?.videoUrl)) {
      layers.push(expandVideoOverlayLayer({ ...raw, slot: i + 1 }))
    }
  }
  const outputAspect = isVideoOverlayOutputAspect(input.data.outputAspect) ? input.data.outputAspect : undefined
  const baseFit = isFit(input.data.baseFit) ? input.data.baseFit : undefined
  const backgroundColor =
    typeof input.data.backgroundColor === "string" && HEX6.test(input.data.backgroundColor) ? input.data.backgroundColor : undefined
  const rest = {
    ...(outputAspect ? { outputAspect } : {}),
    ...(baseFit ? { baseFit } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(input.data.baseBox != null ? { baseBox: storedBaseBox(input.data.baseBox) } : {}),
    ...(storedLayout(input.data.layout) !== undefined ? { layout: input.data.layout as VideoOverlayLayoutId } : {}),
  }
  if (input.planLayers === undefined) return { videoUrl: input.videoUrl, layers, ...rest }
  const plan = parseVideoOverlayLayerPlan(input.planLayers)
  if ("error" in plan) return { videoUrl: input.videoUrl, layers, ...rest, planError: plan.error }
  const planned = expandVideoOverlayPresets(plan.layers.map(withoutEmptyVideoOverlaySources)).map((l, i) => {
    const { slot: _slot, ...own } = l
    return { ...own, planLayer: i + 1 }
  })
  return { videoUrl: input.videoUrl, layers: [...planned, ...layers], ...rest }
}

/**
 * Slot i's source: the wired handle's, else the layer's own `imageUrl`, else
 * its own `videoUrl` — the one source rule the stage, the panel, the canvas
 * executor and the DAG payload share (the render's merge is the same
 * `wired ?? imageUrl ?? videoUrl`, spec §3.5). Every stored slot, past 20 too:
 * the limit is the layer COUNT, not the slot (layers 1–4 removed from a
 * 24-layer node leave 20 at slots 5–24). Only the wired list is capped, at the
 * 12 handles.
 */
export function videoOverlaySlotSources(
  layers: ReadonlyArray<VideoOverlayLayerInput | null | undefined> | null | undefined,
  wiredImageUrls: ReadonlyArray<string | null | undefined>,
): Array<string | undefined> {
  const stored = Array.isArray(layers) ? layers : []
  const wired = wiredImageUrls.slice(0, VIDEO_OVERLAY_HANDLE_IDS.length)
  return Array.from({ length: Math.max(stored.length, wired.length) }, (_, i) => {
    const w = wired[i]
    if (nonEmpty(w)) return w
    const own = asLayer(stored[i])
    return nonEmpty(own?.imageUrl) ? own.imageUrl : nonEmpty(own?.videoUrl) ? own.videoUrl : undefined
  })
}

/** Everything that decides what a Video Overlay run paints. */
export interface VideoOverlayComposition {
  /** The resolved base video URL. */
  readonly baseUrl?: string | null
  /** The image or video each slot draws, by slot index (`videoOverlaySlotSources`). */
  readonly sources: ReadonlyArray<string | null | undefined>
  /** The node's stored settings — never the expanded request. */
  readonly data: VideoOverlayNodeFields
  /** The wired `layerPlan` value (string or array); absent when nothing is wired. */
  readonly planLayers?: unknown
  /** The 1-based slots whose wired source is a video (the assembly's `wiredVideoSlots`); absent or empty = every wire is an image. */
  readonly videoSlots?: Iterable<number> | null
}

/**
 * A value with every object's keys sorted and every null / undefined object
 * field dropped (the assembly reads both as absent); array positions are kept.
 * A jsonb round-trip re-orders object keys, so a node read back from the DB
 * (a schedule / webhook / app run) and the same node in the editor (insertion
 * order) must give one key.
 */
function canonicalValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : canonicalValue(x)))
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k]
      if (x !== undefined && x !== null) out[k] = canonicalValue(x)
    }
    return out
  }
  return v
}

/**
 * The longest `resultCompositionKey` the REST route accepts. The canvas sends
 * its key with a single-node Run so the job's output_data carries it (a result
 * that lands after a page reload reads fresh); the route stores it opaquely and
 * reads it for nothing else. A full 20-layer composition with long signed URLs
 * fits well inside; a canvas key past it is not sent.
 */
export const VIDEO_OVERLAY_MAX_COMPOSITION_KEY_LENGTH = 65_536

/**
 * The composition key a run stamps on its result (`resultCompositionKey`): the
 * base, every slot's image, the layers, the output aspect, the fit, the pad
 * colour, the base box, the layout and which wired slots are videos. A later
 * change to any of them marks the result "Result (old)".
 * Canonical — independent of object key order, of absent vs undefined vs null
 * fields, and of trailing empty slots — so the canvas (the node and its
 * single-node Run) and the DAG payload give one key for one composition.
 */
export function videoOverlayCompositionKey(c: VideoOverlayComposition): string {
  const sources = c.sources.map((s) => (typeof s === "string" && s.length > 0 ? s : null))
  while (sources.length > 0 && sources[sources.length - 1] === null) sources.pop()
  const parts: unknown[] = [
    c.baseUrl || null,
    sources,
    Array.isArray(c.data.layers) ? c.data.layers : [],
    c.data.outputAspect ?? null,
    c.data.baseFit ?? null,
    c.data.backgroundColor ?? null,
  ]
  // Appended only when a plan is wired, so a node with no plan keeps today's key.
  // The PARSED plan is hashed: a JSON string and its array give one key.
  if (c.planLayers !== undefined) {
    const plan = parseVideoOverlayLayerPlan(c.planLayers)
    parts.push("error" in plan ? "invalid" : plan.layers)
  }
  // Likewise only when set, as ONE object — never confused with the plan (an array or "invalid").
  const layout = storedLayout(c.data.layout)
  if (c.data.baseBox != null || layout !== undefined) parts.push({ baseBox: c.data.baseBox, layout })
  // A wired slot's kind can change while its URL does not (an extension-less
  // link, a List column's type); only when a wire is a video, so an
  // image-only node keeps its key.
  const videoSlots = [...new Set(c.videoSlots ?? [])].sort((a, b) => a - b)
  if (videoSlots.length > 0) parts.push({ videoSlots })
  return JSON.stringify(canonicalValue(parts))
}

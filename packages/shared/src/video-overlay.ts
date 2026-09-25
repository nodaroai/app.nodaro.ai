/**
 * Video Overlay — timed image layers over a video. The wire contract of the
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
 *   - `resolveVideoOverlayGeometry`: the one placement function the canvas
 *     preview and the ffmpeg worker both call;
 *   - `assembleVideoOverlayRequest`: the one node-data → request assembly both
 *     workflow engines call;
 *   - `videoOverlayCompositionKey` (+ `videoOverlaySlotSources`): the freshness
 *     key a run stamps on its result (`resultCompositionKey`) — the canvas
 *     single-node Run (which sends it with the request, bounded by
 *     `VIDEO_OVERLAY_MAX_COMPOSITION_KEY_LENGTH`) and the DAG payload compute
 *     it with this one function, and the node compares it against the key of
 *     its current settings;
 *   - `validateVideoOverlayRequest`: what a schema cannot express, at every
 *     engine entry. It returns a CODE, never English: `formatVideoOverlayError`
 *     renders the route / worker text, the canvas renders the code through its
 *     dictionaries.
 * Wire contract only — no prompt content, no I/O.
 */
import { OVERLAY_ANCHORS, type OverlayAnchor } from "./image-overlay-layers.js"
import { ASPECT_RATIO_DIMENSIONS } from "./model-constants.js"

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
 * the boundary. v1 renders NO pip for it: it is not in the node's inputs nor
 * any handle registry; both input resolvers route an edge on it into
 * `inputs.layerPlan`, which v1 ignores.
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
export const VIDEO_OVERLAY_WARNING_CODES = ["clipped", "skipped", "animated_first_frame", "audio_reencoded"] as const
export type VideoOverlayWarningCode = (typeof VIDEO_OVERLAY_WARNING_CODES)[number]
export const VIDEO_OVERLAY_ERROR_CODES = [
  "no_layers", "too_many_layers", "incomplete_box", "layer_without_image",
  "time_out_of_range", "end_before_start", "fit_without_aspect", "field_out_of_bounds",
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

/** A layer as stored and enqueued — complete: every box and look field present. */
export interface VideoOverlayLayer {
  /**
   * Used when the layer's canvas handle is not wired (MCP, template, layers
   * 13 and up). Wiring the handle CLEARS it — on the canvas by the one `layers[]`
   * writer (D3), on JSON-written workflows by the write-boundary pass (D10) —
   * and the run-time merge is still `wired ?? imageUrl` everywhere.
   */
  imageUrl?: string
  /** 1-based canvas slot (overlay = 1 … overlay12 = 12; 13 and up handle-less), stamped by both engine assemblies. Messages prefer it. */
  slot?: number
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
  /** % of the output canvas height (1..100); absent = follows the image's aspect. */
  height?: number
  fit: VideoOverlayFit
  /** 0..1 */
  opacity: number
  /** Fade + slight scale in and out, 0.15 s each way. */
  animate: boolean
  /** Integer 0..100; absent = its position (slot − 1: layer 1 lowest). */
  zIndex?: number
}

/** A layer as a WRITER may send it (workflow JSON, a template, the canvas): every field optional; `null` means absent. */
export type VideoOverlayLayerInput = { [K in keyof VideoOverlayLayer]?: VideoOverlayLayer[K] | null }

/** A layer on the REST / SDK wire: image and start required; the box may be a preset, explicit fields, or nothing (→ the corner-badge default). */
export type VideoOverlayLayerSpec = { imageUrl: string; start: number } & Partial<Omit<VideoOverlayLayer, "imageUrl" | "start">>

/** The `POST /v1/video-overlay` body. */
export interface VideoOverlayRequest {
  videoUrl: string
  /** 1..20 */
  layers: VideoOverlayLayerSpec[]
  outputAspect?: VideoOverlayOutputAspect
  /** Only with `outputAspect`; default cover. */
  baseFit?: VideoOverlayFit
  /** `#rrggbb`, only with `outputAspect` (drawn under `contain`); default `#000000`. */
  backgroundColor?: string
}

/** A request whose layers went through `expandVideoOverlayPresets`. */
export interface ExpandedVideoOverlayRequest extends Omit<VideoOverlayRequest, "layers"> {
  layers: VideoOverlayLayer[]
}

/** `output_data.warnings[]`: `layer` = 0-based index of the request's layers (absent for a render-wide warning such as `audio_reencoded`), `slot` when known. */
export interface VideoOverlayWarning {
  readonly layer?: number
  readonly slot?: number
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
function isFit(v: unknown): v is VideoOverlayFit {
  return v === "contain" || v === "cover"
}

/**
 * A `layers[]` entry as a layer, or null when it is not a plain object. Layer
 * arrays reach this module from untrusted workflow JSON (the MCP write sites
 * type nodes as `record<string, unknown>`), so a bare string / number / array
 * entry is read as an ABSENT layer — never spread, never `in`-probed.
 */
function asLayer(v: unknown): VideoOverlayLayerInput | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as VideoOverlayLayerInput) : null
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

const TRAILING_DEFAULTS = { x: 0, y: 0, fit: "contain", opacity: 1, animate: true } as const

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
 * Trailing defaults x 0, y 0, fit contain, opacity 1, animate true are filled
 * here and nowhere else. `null` reads as absent. Returned BY REFERENCE when
 * nothing changes; idempotent, tag included.
 */
export function expandVideoOverlayLayer(raw: VideoOverlayLayerInput | null | undefined): VideoOverlayLayer {
  const obj = asLayer(raw)
  const layer = obj ? clean(obj) : {}
  const present = VIDEO_OVERLAY_BOX_FIELDS.filter((f) => layer[f] !== undefined)
  let out: Record<string, unknown>
  if (isVideoOverlayPresetId(layer.preset)) {
    const box = videoOverlayPresetBox(layer.preset, layer.corner)
    out = { ...box, ...layer }
    if (present.some((f) => layer[f] !== box[f])) delete out.preset
  } else if (present.length === 0) {
    out = { ...DEFAULT_VIDEO_OVERLAY_LAYER, ...videoOverlayPresetBox("corner-badge", layer.corner), ...layer }
  } else if (layer.anchor === undefined || layer.width === undefined) {
    return raw as VideoOverlayLayer
  } else {
    out = { ...layer }
  }
  for (const [k, v] of Object.entries(TRAILING_DEFAULTS)) if (out[k] === undefined) out[k] = v
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
 * D10 — delete `imageUrl` from every layer whose canvas handle is wired
 * (`wiredSlots`: 1-based). Pure over `layers` (the route has no edges, so this
 * is a sibling of the expansion, not part of it). Slots 13 and up have no handle
 * and are never touched. The input array by reference when nothing changes.
 */
export function clearWiredVideoOverlayImageUrls<T extends VideoOverlayLayerInput | null | undefined>(
  layers: readonly T[],
  wiredSlots: ReadonlySet<number>,
): readonly T[] {
  let out: T[] | null = null
  for (const slot of wiredSlots) {
    if (!Number.isInteger(slot) || slot < 1 || slot > VIDEO_OVERLAY_HANDLE_IDS.length) continue
    const layer = layers[slot - 1]
    if (!asLayer(layer) || !("imageUrl" in (layer as object))) continue
    out ??= [...layers]
    const { imageUrl: _cleared, ...rest } = layer as VideoOverlayLayerInput
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
    const next = cleared.map((l) => {
      // null / missing stays as stored; a non-object entry is left untouched so
      // the validator sees it (it reads as an absent layer everywhere).
      if (!asLayer(l)) return l
      const e = expandVideoOverlayLayer(l)
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
  /** 0-based index in the request's `layers[]` (the worker's graph layers carry it). */
  readonly index?: number | null
}

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
      const own = isSlot(l?.slot) ? l.slot - 1 : isIndex(l?.index) ? l.index : i
      return { i, z: typeof l?.zIndex === "number" && Number.isFinite(l.zIndex) ? l.zIndex : own }
    })
    .sort((a, b) => a.z - b.z || a.i - b.i)
    .map((e) => e.i)
}

export interface VideoOverlayRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}
export interface VideoOverlayCanvas {
  readonly w: number
  readonly h: number
}
export interface VideoOverlayGeometry {
  readonly box: VideoOverlayRect
  readonly drawn: VideoOverlayRect
}

const evenFloor = (n: number): number => Math.max(2, Math.floor(n / 2) * 2)

/**
 * The output canvas: `ASPECT_RATIO_DIMENSIONS[outputAspect]` when a target
 * aspect is set; otherwise the base's DISPLAY size (rotation already applied by
 * the caller's probe) with the sample aspect ratio resolved and both sides
 * rounded down to even — `trunc(iw*sar/2)*2 × trunc(ih/2)*2`, what the ffmpeg
 * base chain produces. null when neither is known.
 */
export function videoOverlayCanvas(
  display: { readonly width: number; readonly height: number; readonly sar?: number } | null | undefined,
  outputAspect?: string | null,
): VideoOverlayCanvas | null {
  if (isVideoOverlayOutputAspect(outputAspect)) {
    const d = ASPECT_RATIO_DIMENSIONS[outputAspect]!
    return { w: d.width, h: d.height }
  }
  if (!display || !(display.width > 0) || !(display.height > 0)) return null
  const sar = typeof display.sar === "number" && Number.isFinite(display.sar) && display.sar > 0 ? display.sar : 1
  return { w: evenFloor(display.width * sar), h: evenFloor(display.height) }
}

function anchorFactors(anchor: OverlayAnchor): readonly [number, number] {
  const h = anchor.endsWith("left") ? 0 : anchor.endsWith("right") ? 1 : 0.5
  const v = anchor.startsWith("top") ? 0 : anchor.startsWith("bottom") ? 1 : 0.5
  return [h, v]
}

/**
 * Spec §3.4. `width%` → px of the canvas width; height follows the image's
 * aspect unless `height%` is set; nine anchors; x/y are additive offsets in %
 * of the canvas. An aspect-following box taller than the canvas is fitted
 * inside it (both sides scaled, aspect kept) — so `drawn` never exceeds the
 * canvas, which is what bounds the sharp pre-fit at one canvas of RGBA. `fit`:
 * contain → the image scaled inside the box, centred; cover → the box itself.
 * The only post-processing is rounding `drawn` DOWN to even, floored at 2 × 2.
 * Differences from Image Overlay's copies (on purpose): no 8192 edge shrink,
 * the canvas clamp, the even rounding.
 */
export function resolveVideoOverlayGeometry(
  canvas: VideoOverlayCanvas,
  layer: Pick<VideoOverlayLayer, "anchor" | "x" | "y" | "width" | "height" | "fit">,
  imageAspect: number,
): VideoOverlayGeometry {
  const aspect = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 1
  let bw = Math.max(1, Math.round((layer.width / 100) * canvas.w))
  let bh = layer.height !== undefined ? Math.max(1, Math.round((layer.height / 100) * canvas.h)) : Math.max(1, Math.round(bw / aspect))
  if (layer.height === undefined && bh > canvas.h) {
    bw = Math.max(1, Math.round(bw * (canvas.h / bh)))
    bh = canvas.h
  }
  const [ax, ay] = anchorFactors(layer.anchor)
  const left = Math.round(ax * (canvas.w - bw) + (layer.x / 100) * canvas.w)
  const top = Math.round(ay * (canvas.h - bh) + (layer.y / 100) * canvas.h)
  let dw: number
  let dh: number
  if (layer.fit === "cover") {
    dw = bw
    dh = bh
  } else if (bw / bh > aspect) {
    dh = bh
    dw = bh * aspect
  } else {
    dw = bw
    dh = bw / aspect
  }
  const width = evenFloor(dw)
  const height = evenFloor(dh)
  return {
    box: { left, top, width: bw, height: bh },
    drawn: { left: left + Math.floor((bw - width) / 2), top: top + Math.floor((bh - height) / 2), width, height },
  }
}

export interface VideoOverlayIssue {
  readonly ok: false
  readonly code: VideoOverlayErrorCode
  /** 0-based index into the validated `layers[]`. */
  readonly layer?: number
  readonly slot?: number
  readonly params: Readonly<Record<string, string | number>>
}
export type VideoOverlayValidation = { readonly ok: true } | VideoOverlayIssue

export interface VideoOverlayValidationInput {
  readonly layers?: ReadonlyArray<VideoOverlayLayerInput | null | undefined> | null
  readonly outputAspect?: string | null
  readonly baseFit?: string | null
  readonly backgroundColor?: string | null
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
 * the only check). A non-object `layers[]` entry reads as an empty layer. The
 * FIRST failure, as a code.
 */
export function validateVideoOverlayRequest(body: VideoOverlayValidationInput): VideoOverlayValidation {
  const layers = Array.isArray(body.layers) ? body.layers : []
  if (layers.length === 0) return { ok: false, code: "no_layers", params: {} }
  if (layers.length > VIDEO_OVERLAY_MAX_LAYERS) {
    return { ok: false, code: "too_many_layers", params: { max: VIDEO_OVERLAY_MAX_LAYERS, count: layers.length } }
  }
  for (let i = 0; i < layers.length; i++) {
    const l: VideoOverlayLayerInput = asLayer(layers[i]) ?? {}
    const at = (code: VideoOverlayErrorCode, params: Record<string, string | number> = {}): VideoOverlayIssue => ({
      ok: false,
      code,
      layer: i,
      ...(typeof l.slot === "number" ? { slot: l.slot } : {}),
      params,
    })
    const boxFields = VIDEO_OVERLAY_BOX_FIELDS.filter((f) => l[f] !== undefined && l[f] !== null)
    if (!isVideoOverlayPresetId(l.preset) && boxFields.length > 0 && (l.anchor == null || l.width == null)) return at("incomplete_box")
    const bad = outOfBounds(l)
    if (bad) return at("field_out_of_bounds", bad)
    if (typeof l.imageUrl !== "string" || l.imageUrl.length === 0) return at("layer_without_image")
    if (!inTimeRange(l.start)) return at("time_out_of_range", { field: "start", max: VIDEO_OVERLAY_MAX_TIME_SEC })
    if (l.end !== undefined && l.end !== null) {
      if (!inTimeRange(l.end)) return at("time_out_of_range", { field: "end", max: VIDEO_OVERLAY_MAX_TIME_SEC })
      if (!(l.end > l.start)) return at("end_before_start", { start: l.start, end: l.end })
    }
  }
  if (!isVideoOverlayOutputAspect(body.outputAspect) && (body.baseFit != null || body.backgroundColor != null)) {
    return { ok: false, code: "fit_without_aspect", params: {} }
  }
  return { ok: true }
}

const MESSAGES: { readonly [C in VideoOverlayErrorCode]: (p: Readonly<Record<string, string | number>>) => string } = {
  no_layers: () => "At least 1 layer is required",
  too_many_layers: (p) => `At most ${p.max} layers (got ${p.count})`,
  incomplete_box: () => "anchor and width are required without a preset",
  layer_without_image: () => "no image — connect one to the layer's handle or set imageUrl",
  time_out_of_range: (p) => `${p.field} must be between 0 and ${p.max} s`,
  end_before_start: (p) => `end (${p.end} s) must be after start (${p.start} s)`,
  fit_without_aspect: () => "baseFit and backgroundColor need an outputAspect",
  field_out_of_bounds: (p) => `${p.field} is out of range (allowed: ${p.allowed})`,
}

/** `Layer <slot>` when the layer came from the canvas, else `layers[<index>]`; "" for a request-wide failure. */
export function videoOverlayLayerLabel(ref: { readonly layer?: number; readonly slot?: number }): string {
  return typeof ref.slot === "number" ? `Layer ${ref.slot}` : typeof ref.layer === "number" ? `layers[${ref.layer}]` : ""
}

/** The ONE English rendering of a verdict — the route's 400 text and the worker's error message. */
export function formatVideoOverlayError(issue: VideoOverlayIssue): string {
  const label = videoOverlayLayerLabel(issue)
  const text = MESSAGES[issue.code](issue.params)
  return label ? `${label}: ${text}` : text
}

/** The node-data fields the assembly reads. */
export interface VideoOverlayNodeFields {
  readonly layers?: ReadonlyArray<VideoOverlayLayerInput | null | undefined> | null
  readonly outputAspect?: string | null
  readonly baseFit?: string | null
  readonly backgroundColor?: string | null
}

/**
 * The ONE node → request assembly, called by the canvas single-node run AND
 * payload-builder (so both engines refuse identically). Per slot i over
 * max(wired handles (≤ 12), stored layers) — every stored slot, so more than
 * 20 layers that render reach the validator's `too_many_layers` instead of
 * being dropped: the image is the wired handle's,
 * else the layer's own `imageUrl`; a slot with neither is dropped; a slot with
 * no settings is the default layer (D2 — a `null` / missing / `{}` entry);
 * `slot = i + 1` is stamped; the layer is expanded. `baseFit` /
 * `backgroundColor` ride as stored, WITH or WITHOUT an `outputAspect`: the
 * validator — not this assembly — refuses them without one
 * (`fit_without_aspect`, spec §3.5), so a JSON-written node carrying a fit
 * and no aspect is refused on both engines instead of silently rendering.
 * (The canvas never builds that request: its two aspect writers clear both
 * fields with the aspect.) A value the route's schema would reject — an
 * unknown aspect or fit, a colour that is not `#rrggbb` — is dropped here.
 */
export function assembleVideoOverlayRequest(input: {
  readonly videoUrl: string
  readonly data: VideoOverlayNodeFields
  readonly wiredImageUrls: ReadonlyArray<string | null | undefined>
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
    const raw = asLayer(stored[i])
    const wiredUrl = wired[i]
    const own = raw?.imageUrl
    const image = typeof wiredUrl === "string" && wiredUrl.length > 0 ? wiredUrl : typeof own === "string" && own.length > 0 ? own : undefined
    if (!image) continue
    layers.push(expandVideoOverlayLayer({ ...(raw ?? {}), imageUrl: image, slot: i + 1 }))
  }
  const outputAspect = isVideoOverlayOutputAspect(input.data.outputAspect) ? input.data.outputAspect : undefined
  const baseFit = isFit(input.data.baseFit) ? input.data.baseFit : undefined
  const backgroundColor =
    typeof input.data.backgroundColor === "string" && HEX6.test(input.data.backgroundColor) ? input.data.backgroundColor : undefined
  return {
    videoUrl: input.videoUrl,
    layers,
    ...(outputAspect ? { outputAspect } : {}),
    ...(baseFit ? { baseFit } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
  }
}

/**
 * Slot i's image: the wired handle's, else the layer's own `imageUrl` — the
 * one source rule the stage, the panel, the canvas executor and the DAG
 * payload share (the render's merge is the same `wired ?? imageUrl`, spec
 * §3.5). Every stored slot, past 20 too: the limit is the layer COUNT, not
 * the slot (layers 1–4 removed from a 24-layer node leave 20 at slots 5–24).
 * Only the wired list is capped, at the 12 handles.
 */
export function videoOverlaySlotSources(
  layers: ReadonlyArray<VideoOverlayLayerInput | null | undefined> | null | undefined,
  wiredImageUrls: ReadonlyArray<string | null | undefined>,
): Array<string | undefined> {
  const stored = Array.isArray(layers) ? layers : []
  const wired = wiredImageUrls.slice(0, VIDEO_OVERLAY_HANDLE_IDS.length)
  return Array.from({ length: Math.max(stored.length, wired.length) }, (_, i) => {
    const w = wired[i]
    if (typeof w === "string" && w.length > 0) return w
    const own = asLayer(stored[i])?.imageUrl
    return typeof own === "string" && own.length > 0 ? own : undefined
  })
}

/** Everything that decides what a Video Overlay run paints. */
export interface VideoOverlayComposition {
  /** The resolved base video URL. */
  readonly baseUrl?: string | null
  /** The image each slot draws, by slot index (`videoOverlaySlotSources`). */
  readonly sources: ReadonlyArray<string | null | undefined>
  /** The node's stored settings — never the expanded request. */
  readonly data: VideoOverlayNodeFields
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
 * base, every slot's image, the layers, the output aspect, the fit and the pad
 * colour. A later change to any of them marks the result "Result (old)".
 * Canonical — independent of object key order, of absent vs undefined vs null
 * fields, and of trailing empty slots — so the canvas (the node and its
 * single-node Run) and the DAG payload give one key for one composition.
 */
export function videoOverlayCompositionKey(c: VideoOverlayComposition): string {
  const sources = c.sources.map((s) => (typeof s === "string" && s.length > 0 ? s : null))
  while (sources.length > 0 && sources[sources.length - 1] === null) sources.pop()
  return JSON.stringify(
    canonicalValue([
      c.baseUrl || null,
      sources,
      Array.isArray(c.data.layers) ? c.data.layers : [],
      c.data.outputAspect ?? null,
      c.data.baseFit ?? null,
      c.data.backgroundColor ?? null,
    ]),
  )
}

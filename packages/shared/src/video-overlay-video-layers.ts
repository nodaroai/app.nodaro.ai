/**
 * Video Overlay video layers — what makes a layer a video, and what kind of
 * layer a wired source becomes. A sibling of `video-overlay.ts`, which imports
 * from here at run time; this file imports from it for TYPES only, so the
 * dependency stays one-way.
 *
 * A layer is a video layer when it carries a non-empty `videoUrl`: the
 * validator's count, the `animate` default and `videoOverlayHasVideoLayer`
 * all read it through `isVideoOverlayVideoLayer`, so they cannot disagree.
 * Wire contract only — no I/O.
 */
import type { VideoOverlayLayerInput } from "./video-overlay.js"
import { DYNAMIC_PRODUCER_TYPES, IMAGE_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "./producer-types.js"
import { resolveEffectiveSourceType } from "./entity-image-handle.js"

/** File extensions a wired source from a node of no fixed kind is read as a video by. */
const LAYER_VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".m4v"] as const
/** File extensions it is read as an image by (a recognisable image stays an image, whatever a List column says). */
const LAYER_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp", ".tif", ".tiff", ".heic", ".heif", ".svg"] as const

/** True when the layer is a plain object with a non-empty `videoUrl`. */
export function isVideoOverlayVideoLayer(layer: unknown): boolean {
  if (layer === null || typeof layer !== "object" || Array.isArray(layer)) return false
  const url = (layer as VideoOverlayLayerInput).videoUrl
  return typeof url === "string" && url.length > 0
}

/** True when any layer is a video layer. Non-array input and non-object entries read as none. */
export function videoOverlayHasVideoLayer(
  layers: ReadonlyArray<VideoOverlayLayerInput | null | undefined> | null | undefined,
): boolean {
  return Array.isArray(layers) && layers.some(isVideoOverlayVideoLayer)
}

/** The URL's path, lower-cased, without query or fragment; a relative or unparseable URL is cut at `?` / `#`. */
function lowerPath(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase()
  } catch {
    return url.split(/[?#]/, 1)[0]!.toLowerCase()
  }
}

export type VideoOverlayWiredLayerKind = "image" | "video"

/** The wire a layer handle receives, as both engines' resolvers know it. */
export interface VideoOverlayWiredSource {
  /** The source node's type. */
  readonly type?: string | null
  /** The source handle the wire leaves (through any teleport). */
  readonly handle?: string | null
  /** The medium the source declares for that handle — a component's or sub-workflow's port (`declaredOutputMediaType`). */
  readonly declaredMediaType?: string | null
  /**
   * The medium a List column's type declares for that handle
   * (`listColumnMediaType`). It ranks BELOW the URL's extension: it only fills
   * the gap for a link with no recognisable one.
   */
  readonly columnMediaType?: string | null
}

/**
 * Pips whose medium the shared effective-type tables (`resolveEffectiveSourceType`)
 * do not name, kept here so the layer rule reads them without changing how
 * those tables route or validate a wire. 3D Render Pro sits in both producer
 * sets: its `stills` pip carries one PNG per shot, its `video` pip the MP4.
 * The dynamic producers hand on a video or an audio file by pip: their video
 * pips are videos whatever their file's name. A frontend guard holds every
 * image or video pip the editor draws, that a layer handle accepts, to its own
 * medium with an extension-less URL.
 */
const LAYER_PIP_KINDS: Readonly<Record<string, Readonly<Record<string, VideoOverlayWiredLayerKind>>>> = {
  "pro-3d-render": { stills: "image", video: "video" },
  "adjust-volume": { "video-out": "video" },
  "pitch-tempo": { "video-out": "video" },
  "voice-changer": { video: "video" },
  "voice-changer-pro": { video: "video" },
  dubbing: { video: "video" },
  "split-media": { video: "video" },
}

/**
 * Layer-plan pips whose plan carries layers of one medium only, so a run
 * estimate can price the node they feed before the plan exists: UGC Cards'
 * plan is its card images. On the `layerPlan` handle nothing else answers
 * `image` before the run (`videoOverlayWireMediumBeforeRun`).
 */
const LAYER_PLAN_PIP_KINDS: Readonly<Record<string, Readonly<Record<string, VideoOverlayWiredLayerKind>>>> = {
  "ugc-cards": { layerPlan: "image" },
}

const ownKey = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined)

/** The kind of a single-medium producer: in exactly one of the image and video producer sets, and not dynamic. */
function producerKind(type: string): VideoOverlayWiredLayerKind | undefined {
  if (DYNAMIC_PRODUCER_TYPES.has(type)) return undefined
  const video = VIDEO_PRODUCER_TYPES.has(type)
  if (video === IMAGE_PRODUCER_TYPES.has(type)) return undefined
  return video ? "video" : "image"
}

/**
 * What a source wired to a layer handle draws as — the ONE rule both engines
 * call, in this order:
 *   1. the medium the wire is known to carry: a pip row of its own
 *      (`LAYER_PIP_KINDS`), the medium a port declares (`declaredMediaType`:
 *      `image` or `video`), or the source's effective type for that handle
 *      (an aggregate lane, a scraper's typed pip, an entity's or an output's
 *      image pip — `resolveEffectiveSourceType`) when that is a single-medium producer;
 *   2. the producer sets, for a single-medium producer only;
 *   3. the URL path's extension, when it is a recognisable video or image one
 *      (a list, a sub-workflow, a producer in both sets);
 *   4. a List column's declared type (`columnMediaType`: `image` or `video`),
 *      for a link with no recognisable extension — so a `.png` in a
 *      `video-url` column stays an image, as it was before video layers;
 *   5. an image, as every layer was before video layers existed.
 */
export function videoOverlayWiredLayerKind(source: VideoOverlayWiredSource, url: string): VideoOverlayWiredLayerKind {
  return kindOfSource(source) ?? kindOfFile(source, url)
}

/** Steps 3–5 of {@link videoOverlayWiredLayerKind}: what the file says, for a source that does not decide by itself. */
function kindOfFile(source: VideoOverlayWiredSource, url: string): VideoOverlayWiredLayerKind {
  const column = source.columnMediaType === "image" || source.columnMediaType === "video" ? source.columnMediaType : undefined
  return kindOfUrl(url) ?? column ?? "image"
}

/** Steps 1–2 of {@link videoOverlayWiredLayerKind}: the kind the source decides by itself, or undefined when its file decides. */
function kindOfSource(source: VideoOverlayWiredSource): VideoOverlayWiredLayerKind | undefined {
  const type = source.type ?? ""
  const handle = source.handle ?? undefined
  const pip = pipRowKind(LAYER_PIP_KINDS, source)
  if (pip) return pip
  if (source.declaredMediaType === "image" || source.declaredMediaType === "video") return source.declaredMediaType
  const effective = resolveEffectiveSourceType(type, handle)
  const carried = effective !== type ? producerKind(effective) : undefined
  if (carried) return carried
  return producerKind(type)
}

/** Step 3: the URL path's recognisable extension, or undefined. */
function kindOfUrl(url: string): VideoOverlayWiredLayerKind | undefined {
  const path = lowerPath(url)
  if (LAYER_VIDEO_EXTENSIONS.some((ext) => path.endsWith(ext))) return "video"
  if (LAYER_IMAGE_EXTENSIONS.some((ext) => path.endsWith(ext))) return "image"
  return undefined
}

/** What a wire hands a Video Overlay before the run: an image, a video, or not known yet. */
export type VideoOverlayWireMedium = VideoOverlayWiredLayerKind | "unknown"

/** Where a wire lands on a Video Overlay: a layer handle, or the `layerPlan` handle. */
export interface VideoOverlayWireBeforeRun {
  /** Default `layer`. */
  readonly target?: "layer" | "plan"
  /** A layer wire's files already known before the run (a List's own cells); none = not known. */
  readonly knownUrls?: readonly string[]
}

/**
 * What a source wired to a Video Overlay hands it, as far as it is known
 * BEFORE the run: the ONE place a run estimate asks.
 *
 * On a layer handle, by the run's own rule ({@link videoOverlayWiredLayerKind}):
 * a source that decides by itself (a pip row, a declared port, a single-medium
 * producer) answers its kind; one whose kind follows its file answers by the
 * files already known (`knownUrls`, read in the run's order: the extension,
 * then a List column's type), and is `unknown` when none is.
 *
 * On the `layerPlan` handle, only a plan pip row answers `image`
 * (`LAYER_PLAN_PIP_KINDS`: UGC Cards' plan is its card images): a declared
 * port, a producer set or a List column says what a FILE is, not what a
 * plan's layers are, so any other plan is `video` when its source is a video
 * and `unknown` otherwise.
 *
 * A run estimate prices `unknown` as a video run, so a quote is never below
 * what the run is charged; once a file is known, the answer is the run's.
 */
export function videoOverlayWireMediumBeforeRun(source: VideoOverlayWiredSource, wire: VideoOverlayWireBeforeRun = {}): VideoOverlayWireMedium {
  if (wire.target === "plan") {
    const row = pipRowKind(LAYER_PLAN_PIP_KINDS, source)
    return row ?? (kindOfSource(source) === "video" ? "video" : "unknown")
  }
  const decided = kindOfSource(source)
  if (decided) return decided
  const known = wire.knownUrls ?? []
  if (known.length === 0) return "unknown"
  return known.some((url) => kindOfFile(source, url) === "video") ? "video" : "image"
}

/** The row of `table` naming the source's handle, or undefined. */
function pipRowKind(
  table: Readonly<Record<string, Readonly<Record<string, VideoOverlayWiredLayerKind>>>>,
  source: VideoOverlayWiredSource,
): VideoOverlayWiredLayerKind | undefined {
  const pips = ownKey(table, source.type ?? "")
  const handle = source.handle ?? undefined
  return pips && handle !== undefined ? ownKey(pips, handle) : undefined
}

/** `list[i]` with `id === id`, its `key` when that is a string. */
function portMedium(list: unknown, id: string, key: "mediaType" | "type"): string | undefined {
  if (!Array.isArray(list)) return undefined
  const port = list.find((p) => p !== null && typeof p === "object" && (p as { id?: unknown }).id === id) as Record<string, unknown> | undefined
  const value = port?.[key]
  return typeof value === "string" ? value : undefined
}

const field = (v: unknown, key: string): unknown => (v !== null && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined)

/**
 * The medium a component or sub-workflow declares for the handle a wire
 * leaves (`image`, `video`, `audio`, `text`, `any`), or undefined. A
 * sub-workflow (and a component) names its output ports in
 * `routeSnapshot.outputPorts`, its handles `out_<port>`; a component falls back
 * to `componentMetadata.outputs[].type`; a sub-workflow input node names its
 * ports in `ports`, by their own ids. The same fields both engines' input
 * resolvers route these wires by. (A List's column type is not a port
 * declaration: `listColumnMediaType` reads it, and it ranks below the URL's
 * extension.) Untrusted node data: anything malformed declares nothing.
 */
export function declaredOutputMediaType(type: string | null | undefined, data: unknown, handle: string | null | undefined): string | undefined {
  if (typeof handle !== "string" || data === null || typeof data !== "object") return undefined
  if (type === "sub-workflow-input") return portMedium(field(data, "ports"), handle, "mediaType")
  if (type !== "sub-workflow" && type !== "component") return undefined
  const portId = handle.replace(/^out_/, "")
  const fromSnapshot = portMedium(field(field(data, "routeSnapshot"), "outputPorts"), portId, "mediaType")
  if (fromSnapshot !== undefined || type !== "component") return fromSnapshot
  return portMedium(field(field(data, "componentMetadata"), "outputs"), portId, "type")
}

/** A List column type → the medium its cells declare (its text and JSON columns declare none). */
const LIST_COLUMN_MEDIA: Readonly<Record<string, string>> = { "image-url": "image", "video-url": "video", "audio-url": "audio" }

/**
 * The medium a List's column type declares for the pip a wire leaves
 * (`image-url` → image, `video-url` → video, `audio-url` → audio): the column
 * whose `handleId` the pip names, else its first column — the column a List's
 * own `list` pip carries, as both engines' input resolvers route it. Undefined
 * for any other source, a text or JSON column, or malformed data. Handed to the
 * wired-kind rule as `columnMediaType`, where it ranks below the URL's extension.
 */
export function listColumnMediaType(type: string | null | undefined, data: unknown, handle: string | null | undefined): string | undefined {
  if (type !== "list" || data === null || typeof data !== "object") return undefined
  const columns = field(data, "columns")
  if (!Array.isArray(columns)) return undefined
  const isColumn = (c: unknown): c is Record<string, unknown> => c !== null && typeof c === "object"
  const column = columns.find((c) => isColumn(c) && c.handleId === handle) ?? columns[0]
  const columnType = isColumn(column) ? column.type : undefined
  return typeof columnType === "string" && Object.hasOwn(LIST_COLUMN_MEDIA, columnType) ? LIST_COLUMN_MEDIA[columnType] : undefined
}

/**
 * A WIRED slot's layer as it is stored: the expanded layer `expanded`, minus an
 * `animate` its writer did not set (`written`: the stored layer and the edit
 * applied to it). A wired slot's kind is its wire's, known only where the wire
 * is read — the run's assembly and the canvas stage — and the expansion there
 * fills the fade default by that kind (on for an image, off for a video); a
 * default stored here would fix one kind's default on the other, so a video
 * wired in later would fade. `written` itself when the result has the same
 * fields (an idempotent write); `expanded` by reference when nothing is removed.
 */
export function withoutImpliedVideoOverlayAnimate(
  expanded: VideoOverlayLayerInput,
  written: VideoOverlayLayerInput | null | undefined,
): VideoOverlayLayerInput {
  if (written?.animate != null || expanded.animate === undefined) return expanded
  const { animate: _implied, ...rest } = expanded
  const fields = rest as Readonly<Record<string, unknown>>
  const keys = Object.keys(fields)
  const same = written != null && keys.length === Object.keys(written).length && keys.every((k) => fields[k] === (written as Readonly<Record<string, unknown>>)[k])
  return same ? written : rest
}

/**
 * A WIRED slot's layer as the run reads it when its wire is an image: without
 * a stored `sound`. A wired slot's kind is its wire's, read at the run, so a
 * sound set while the wire was a video (or before a List column's type, a
 * dynamic source's output or an upstream re-run changed it) is skipped rather
 * than refused: the run goes ahead, silent, and its fade default follows the
 * image. Only the assembly calls this, for wired slots; a layer that carries
 * its OWN image (the API, MCP, an unwired slot, a plan) keeps its sound and
 * the validator refuses it (`sound_without_video`). By reference when there is
 * no sound.
 */
export function withoutVideoOverlaySound<T extends VideoOverlayLayerInput>(layer: T): T {
  if (!Object.hasOwn(layer, "sound")) return layer
  const { sound: _skipped, ...rest } = layer
  return rest as T
}

/**
 * A layer without an empty-string `imageUrl` / `videoUrl`: every reader treats
 * one as absent, and the REST route's URL schema refuses it, so the assembly
 * drops it and a stored `{ imageUrl, videoUrl: "" }` runs as an image layer on
 * both engines. By reference when it has none.
 */
export function withoutEmptyVideoOverlaySources<T extends VideoOverlayLayerInput>(layer: T): T {
  if (layer.imageUrl !== "" && layer.videoUrl !== "") return layer
  const out: Record<string, unknown> = { ...layer }
  if (out.imageUrl === "") delete out.imageUrl
  if (out.videoUrl === "") delete out.videoUrl
  return out as T
}

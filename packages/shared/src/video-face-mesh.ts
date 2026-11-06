/**
 * Video Face Mesh (`POST /v1/video-face-mesh`, job type `video-face-mesh`):
 * thin GRAY face lines — a wireframe, and darker eye and lip outlines, each a
 * tone of the picture under it — drawn on the faces of a clip, frame for
 * frame. An internal step of Nodaro Motion's face masking: the lines go on
 * the masked (or depth) clip so the video model still sees where the mouth
 * and the eyes are. A request may draw only the eye and lip outlines, only
 * the lip outline, or the face's contours (`parts`).
 *
 * Priced by the clip's length at the 30 fps basis Video Mask uses
 * (`videoMaskBilledSeconds`), one row per length bucket.
 */
import { pricedClipSeconds } from "./priced-clip-seconds.js"
import { VIDEO_MASK_LIMITS, type VideoMaskZone } from "./video-mask.js"
import type { VideoDepthColormap } from "./video-depth.js"

/** The route, as the Cast Swap engine calls it. */
export const VIDEO_FACE_MESH_PATH = "/v1/video-face-mesh"

export const VIDEO_FACE_MESH_LIMITS = {
  /** The longest clip a run accepts, in seconds of PRICED length (the 30 fps basis): Video Mask's own cap. */
  MAX_BILLED_SEC: VIDEO_MASK_LIMITS.MAX_BILLED_SEC,
  /** `minFaceHeightPct` / `maxFaceHeightPct` bounds (0 = off). */
  FACE_HEIGHT_PCT_MIN: 0,
  FACE_HEIGHT_PCT_MAX: 100,
  /** `zone` margin bounds, as Video Mask's. */
  ZONE_MARGIN_PCT_MIN: VIDEO_MASK_LIMITS.ZONE_MARGIN_PCT_MIN,
  ZONE_MARGIN_PCT_MAX: VIDEO_MASK_LIMITS.ZONE_MARGIN_PCT_MAX,
} as const

/**
 * What a face mesh run draws on each face (`VideoFaceMeshRequest.parts`):
 * `"full"` (the default) the thin wireframe and the darker eye and lip
 * outlines; `"features"` the eye outlines and the lip outline only, no
 * wireframe; `"mouth"` the lip outline only; `"contours"` the face oval,
 * both eyebrows, the nose and the eye and lip outlines, no wireframe (a host
 * that draws them says so to its engine: `videoFaceMeshContours`).
 */
export const VIDEO_FACE_MESH_PARTS = ["full", "features", "mouth", "contours"] as const
export type VideoFaceMeshParts = (typeof VIDEO_FACE_MESH_PARTS)[number]

/**
 * The face mesh's layers (`VideoFaceMeshRequest.layers`), each drawn or not
 * on its own:
 *   - `wireframe`: the thin mesh over the whole face;
 *   - `eyes`: the eye outlines; `lips`: the lip outline, outer and inner;
 *   - `contours`: the face oval, both eyebrows and the nose. With it on, every
 *     line drawn leaves out what the face hides (a turned face's far side);
 *     with it off, nothing is left out;
 *   - `irises`: a circle round each iris and a dot at its centre, drawn only
 *     inside the eye's opening (an eyelid covers it, a closed eye hides it);
 *   - `bold`: the lines drawn thicker and in a deeper tone. It draws nothing
 *     of its own: it changes the lines of the other layers.
 * Every `parts` value is one set of layers (`videoFaceMeshLayersOfParts`),
 * drawn exactly as that value is.
 */
export const VIDEO_FACE_MESH_LAYERS = ["wireframe", "eyes", "lips", "contours", "irises", "bold"] as const
export type VideoFaceMeshLayer = (typeof VIDEO_FACE_MESH_LAYERS)[number]
/** The layers that draw lines of their own (all but `bold`): a set needs at least one. */
export const VIDEO_FACE_MESH_LINE_LAYERS = ["wireframe", "eyes", "lips", "contours", "irises"] as const satisfies readonly VideoFaceMeshLayer[]
/** A set of layers: each one on when `true`; left out or `false` is off. */
export type VideoFaceMeshLayers = { readonly [K in VideoFaceMeshLayer]?: boolean }

const PARTS_LAYERS: Readonly<Record<VideoFaceMeshParts, readonly VideoFaceMeshLayer[]>> = {
  full: ["wireframe", "eyes", "lips"],
  features: ["eyes", "lips"],
  mouth: ["lips"],
  contours: ["eyes", "lips", "contours"],
}

/** The set of layers a `parts` value draws (left out: `"full"`), a new object with only its layers, each `true`. */
export function videoFaceMeshLayersOfParts(parts: VideoFaceMeshParts = "full"): VideoFaceMeshLayers {
  return Object.fromEntries(PARTS_LAYERS[parts].map((l) => [l, true]))
}

/** The set with only its layers that are on, each `true`, in `VIDEO_FACE_MESH_LAYERS` order: a new object. */
export function videoFaceMeshLayersOn(layers: VideoFaceMeshLayers | null | undefined): VideoFaceMeshLayers {
  return Object.fromEntries(VIDEO_FACE_MESH_LAYERS.filter((l) => layers?.[l] === true).map((l) => [l, true]))
}

/** Whether the set draws any line (a layer other than `bold` on). */
export function videoFaceMeshLayersDrawLines(layers: VideoFaceMeshLayers | null | undefined): boolean {
  return VIDEO_FACE_MESH_LINE_LAYERS.some((l) => layers?.[l] === true)
}

/**
 * The `parts` value that draws exactly this set of layers, or undefined when
 * none does (a set only layers can name: the irises, bold lines, the eyes
 * alone…). `among` limits the values it may answer (a setting that takes only
 * some of them).
 */
export function videoFaceMeshPartsOfLayers(
  layers: VideoFaceMeshLayers | null | undefined,
  among: readonly VideoFaceMeshParts[] = VIDEO_FACE_MESH_PARTS,
): VideoFaceMeshParts | undefined {
  const on = VIDEO_FACE_MESH_LAYERS.filter((l) => layers?.[l] === true)
  return among.find((p) => PARTS_LAYERS[p].length === on.length && PARTS_LAYERS[p].every((l) => on.includes(l)))
}

/**
 * The version of what a face mesh run draws for a given clip and settings:
 * every finished `video-face-mesh` job reports it as `output_data.recipe`,
 * for the caller to record beside a clip it stores with the lines on it (a
 * trend's approved face mask). Nothing on the platform compares it yet: a
 * stored mask is held to Video Mask's recipe and the engine's own.
 *
 * BUMP IT (to the date of the change) whenever the drawing changes for the
 * same input: the model, the crop, the smoothing, the filters, the colours or
 * the widths. Never for pricing, limits or messages. 2026-11-02: MediaPipe's
 * refined landmark model (478 points, a 256 × 256 crop) in place of the basic
 * one; the lines' colours and widths are 2026-11-01's. 2026-11-03: a face gets
 * lines only when it is found in at least 3 frames of its track (found faces
 * at the same place in frames at most 2 apart): one found in a frame or two
 * is never drawn.
 */
export const VIDEO_FACE_MESH_RECIPE = "2026-11-03"

const VIDEO_FACE_MESH_BUCKETS_SEC = [5, 10, 15, 30, 60, 120, 300] as const

/** Every price row, smallest first (`video-face-mesh:<n>s`). */
export function videoFaceMeshCreditIds(): string[] {
  return VIDEO_FACE_MESH_BUCKETS_SEC.map((sec) => `video-face-mesh:${sec}s`)
}

/**
 * The price row for a clip priced at `billedSec` seconds: the smallest bucket
 * that holds it, after `pricedClipSeconds` (up to 0.05 s past a bucket's length
 * stays in that bucket). An unknown or non-positive length, or one past the cap,
 * prices the LONGEST row (the route measures every clip and refuses one past
 * the cap, so this is only ever a ceiling).
 */
export function videoFaceMeshCreditId(billedSec: number | null | undefined): string {
  const ids = videoFaceMeshCreditIds()
  if (typeof billedSec !== "number" || !Number.isFinite(billedSec) || billedSec <= 0) return ids[ids.length - 1]!
  const priced = pricedClipSeconds(billedSec)
  const i = VIDEO_FACE_MESH_BUCKETS_SEC.findIndex((b) => priced <= b)
  return ids[i === -1 ? ids.length - 1 : i]!
}

/** `POST /v1/video-face-mesh` request body. */
export interface VideoFaceMeshRequest {
  /** The clip the faces are FOUND in (the original). */
  readonly videoUrl: string
  /** The clip the lines are DRAWN on (default `videoUrl`): the masked or depth clip. Same frame count. */
  readonly drawOnUrl?: string
  /** A mask video (white = covered, same frame count): only faces whose box centre lies inside it are drawn. */
  readonly maskUrl?: string
  /** Draw only faces at least this % of the frame's height (default 0 = off). */
  readonly minFaceHeightPct?: number
  /** Draw only faces at most this % of the frame's height (0 = no cap). */
  readonly maxFaceHeightPct?: number
  /** Margins (% of the frame) where no face is drawn. */
  readonly zone?: Partial<VideoMaskZone> | null
  /**
   * The depth map's colormap (Video Depth's `VIDEO_DEPTH_COLORMAPS`) when the
   * lines go on a depth map: each line is then a colour OF that map — the map
   * at the line's tone of the depth under it. Needs `depthUrl`, except
   * `grayscale` (a gray depth clip is its own depth). Left out with a
   * `depthUrl`: `grayscale`.
   */
  readonly colormap?: VideoDepthColormap
  /**
   * The GRAYSCALE depth render of the clip (Video Depth with `colormap:
   * "grayscale"`, same frame count as `videoUrl`, any size): the depth each
   * line's colour is read from. Left out (a blurred mask, a gray depth clip
   * drawn on directly): each line is a gray tone of the pixel under it.
   */
  readonly depthUrl?: string
  /**
   * What is drawn on each face (`VIDEO_FACE_MESH_PARTS`): left out or
   * `"full"`, the wireframe and the eye and lip outlines; `"features"`, the
   * eye and lip outlines only; `"mouth"`, the lip outline only. The outlines
   * are drawn as they are in the full mesh (the same tone and width).
   */
  readonly parts?: VideoFaceMeshParts
  /**
   * What is drawn, layer by layer (`VIDEO_FACE_MESH_LAYERS`), in place of
   * `parts` (never both). At least one layer other than `bold`. A set that is
   * a `parts` value's draws exactly as that value does.
   */
  readonly layers?: VideoFaceMeshLayers
}

/** A finished `video-face-mesh` job's `output_data`. */
export interface VideoFaceMeshOutput {
  /** The drawn clip: `drawOnUrl`'s frame count, size and frame rate, its audio copied untouched. */
  readonly videoUrl: string
  readonly width: number
  readonly height: number
  readonly frames: number
  /** Frames with at least one face drawn. */
  readonly framesWithFaces: number
  /** Faces drawn, summed over the frames (0 = nothing drawn; the clip comes back as it was sent). */
  readonly facesDrawn: number
  /** The map the lines were coloured from (a request with `depthUrl`); absent = gray tones of the pixel under them. */
  readonly colormap?: VideoDepthColormap
  /** What was drawn when it was not the full mesh (a request with `parts` `"features"` or `"mouth"`); absent = the full mesh. */
  readonly parts?: Exclude<VideoFaceMeshParts, "full">
  /** The layers drawn, for a request that named `layers` (only those on, each `true`); absent: `parts` says. */
  readonly layers?: VideoFaceMeshLayers
  readonly recipe: string
}

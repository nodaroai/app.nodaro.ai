/**
 * Video Face Mesh (`POST /v1/video-face-mesh`, job type `video-face-mesh`):
 * thin GRAY face lines — a wireframe, and darker eye and lip outlines, each a
 * tone of the picture under it — drawn on the faces of a clip, frame for
 * frame. An internal step of Nodaro Motion's face masking: the lines go on
 * the masked (or depth) clip so the video model still sees where the mouth
 * and the eyes are.
 *
 * Priced by the clip's length at the 30 fps basis Video Mask uses
 * (`videoMaskBilledSeconds`), one row per length bucket.
 */
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
 * The version of what a face mesh run draws for a given clip and settings:
 * every finished `video-face-mesh` job reports it as `output_data.recipe`,
 * for the caller to record beside a clip it stores with the lines on it (a
 * trend's approved face mask). Nothing on the platform compares it yet: a
 * stored mask is held to Video Mask's recipe and the engine's own.
 *
 * BUMP IT (to the date of the change) whenever the drawing changes for the
 * same input: the model, the crop, the smoothing, the filters, the colours or
 * the widths. Never for pricing, limits or messages.
 */
export const VIDEO_FACE_MESH_RECIPE = "2026-11-01"

const VIDEO_FACE_MESH_BUCKETS_SEC = [5, 10, 15, 30, 60, 120, 300] as const

/** Every price row, smallest first (`video-face-mesh:<n>s`). */
export function videoFaceMeshCreditIds(): string[] {
  return VIDEO_FACE_MESH_BUCKETS_SEC.map((sec) => `video-face-mesh:${sec}s`)
}

/**
 * The price row for a clip priced at `billedSec` seconds: the smallest bucket
 * that holds it. An unknown or non-positive length, or one past the cap,
 * prices the LONGEST row (the route measures every clip and refuses one past
 * the cap, so this is only ever a ceiling).
 */
export function videoFaceMeshCreditId(billedSec: number | null | undefined): string {
  const ids = videoFaceMeshCreditIds()
  if (typeof billedSec !== "number" || !Number.isFinite(billedSec) || billedSec <= 0) return ids[ids.length - 1]!
  const i = VIDEO_FACE_MESH_BUCKETS_SEC.findIndex((b) => billedSec <= b)
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
  readonly recipe: string
}

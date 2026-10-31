import { VIDEO_FACE_MESH_LIMITS, videoFaceMeshCreditId, videoMaskBilledSeconds } from "@nodaro/shared/media"
import { probeVideoSource } from "../providers/video/ffmpeg-utils.js"

/**
 * Video Face Mesh (`POST /v1/video-face-mesh`): how long the clip is priced
 * at, and so which price row a run is charged from — its length at Video
 * Mask's 30 fps basis (`videoMaskBilledSeconds`: a 60 fps clip is priced at
 * twice its length, since the work is per frame), rounded up to a
 * `video-face-mesh:<n>s` row (`videoFaceMeshCreditId`, one base credit a
 * second of the bucket).
 *
 * A clip that cannot be measured, or is past the cap
 * (`VIDEO_FACE_MESH_LIMITS.MAX_BILLED_SEC`), is REFUSED before anything is
 * reserved: the worker decodes it frame by frame, so it would fail there
 * anyway, after the reservation.
 */
export type VideoFaceMeshLength =
  | { readonly ok: true; readonly billedSec: number; readonly creditId: string }
  | {
      readonly ok: false
      readonly code: "invalid_video_duration" | "video_duration_exceeds_limit"
      readonly message: string
    }

export async function measureVideoFaceMeshLength(videoUrl: string): Promise<VideoFaceMeshLength> {
  let probed: { durationSeconds: number; fps?: number }
  try {
    probed = await probeVideoSource(videoUrl)
  } catch {
    return {
      ok: false,
      code: "invalid_video_duration",
      message: "Could not read the video. The file may be corrupted or an unsupported format.",
    }
  }
  const billed = videoMaskBilledSeconds(probed.durationSeconds, probed.fps)
  if (billed > VIDEO_FACE_MESH_LIMITS.MAX_BILLED_SEC) {
    return {
      ok: false,
      code: "video_duration_exceeds_limit",
      message: `The video is ${Math.ceil(probed.durationSeconds)} seconds (priced as ${Math.ceil(billed)} s at 30 fps). Video Face Mesh takes up to ${VIDEO_FACE_MESH_LIMITS.MAX_BILLED_SEC} seconds.`,
    }
  }
  const billedSec = Math.max(1, Math.ceil(billed))
  return { ok: true, billedSec, creditId: videoFaceMeshCreditId(billedSec) }
}

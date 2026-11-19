import { z } from "zod"

/** What a REST request that still sends `refineFromVideoUrl` is told. */
export const REFINE_FROM_VIDEO_REMOVED_MESSAGE =
  "refineFromVideoUrl is not supported: an entity motion clip is made from sourceImageUrl. " +
  "To keep a clip's motion, camera and timing and change what is in it, use Video Remake " +
  "(POST /v1/video-remake; SDK client.videoRemake). To edit a clip by instruction, use POST /v1/video-to-video."

/**
 * `refineFromVideoUrl` on the location, object and creature motion routes is
 * not an option. A body that sends it is refused (400 `validation_error`, path
 * `refineFromVideoUrl`) rather than stripped: stripped, the request would run
 * and charge an image-to-video from `sourceImageUrl` the caller did not ask for.
 */
export const refineFromVideoRefused = z.never({ error: REFINE_FROM_VIDEO_REMOVED_MESSAGE }).optional()

/** The code of the MCP motion tools' refusal of `refine_from_video_url`. */
export const REFINE_FROM_VIDEO_REMOVED_CODE = "refine_from_video_removed"

/** What an MCP call that still passes `refine_from_video_url` is told. */
export const REFINE_FROM_VIDEO_REMOVED_MCP_MESSAGE =
  "refine_from_video_url is not supported: a motion clip is made from source_image_url. " +
  "To keep a clip's motion, camera and timing and change what is in it, use video_remake. " +
  "To edit a clip by instruction, use modify_video. Nothing was run or charged."

/**
 * The route-error body the three MCP motion tools answer with when a call
 * passes `refine_from_video_url`, or undefined when it does not. The tools'
 * input is a loose object so the unlisted argument reaches the handler:
 * dropped, the call would run and charge an image-to-video instead.
 */
export function refineFromVideoMcpRefusal(args: unknown): string | undefined {
  if ((args as Record<string, unknown> | null)?.refine_from_video_url === undefined) return undefined
  return JSON.stringify({ error: { code: REFINE_FROM_VIDEO_REMOVED_CODE, message: REFINE_FROM_VIDEO_REMOVED_MCP_MESSAGE } })
}

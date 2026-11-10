/**
 * The model a node runs when its data names none, for the node types whose
 * default lives with the server's handlers rather than in `@nodaro/shared`:
 * the handlers and the server's resolved-model registry read these (through
 * `backend/src/workers/handlers/default-models.ts`), and so does the new-node
 * rule (`node-model-levers.ts`) — one constant each, so the model a node is
 * judged on is the model it runs.
 */

/** lip-sync (handlers/video-ai.ts, the route's default). */
export const LIP_SYNC_DEFAULT_PROVIDER = "kling-avatar"
/** edit-image, which runs Upscale Image (handlers/image-ai.ts). */
export const EDIT_IMAGE_DEFAULT_PROVIDER = "recraft-upscale"
/** motion-transfer (handlers/video-ai.ts): Kling 2.6, the catalog's `motion-transfer`. */
export const MOTION_TRANSFER_DEFAULT_PROVIDER = "kling"
/** extend-video (routes/extend-video.ts). */
export const EXTEND_VIDEO_DEFAULT_PROVIDER = "veo-extend"

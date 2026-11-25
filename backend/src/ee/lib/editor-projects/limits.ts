/**
 * The size limits of a video-editor project's content. Pure constants, read
 * by the routes, the storage side and the heavy-work thread alike.
 */

const MB = 1024 * 1024

/**
 * The most a whole project's text may be, inflated, and its canonical text:
 * every save, patch result, version rebuild and restore. A heavy 15-minute
 * captioned project is about 0.7 MB, an hour about 3 MB.
 */
export const PROJECT_TEXT_MAX_BYTES = 8 * MB
/** The most a PUT body (the gzip of a whole project) may be. */
export const PROJECT_BODY_MAX_BYTES = 5 * MB
/** The most a PATCH body (the gzip of a JSON Patch) may be. */
export const PATCH_BODY_MAX_BYTES = 1 * MB
/** The most a JSON Patch may be, inflated. */
export const PATCH_TEXT_MAX_BYTES = 5 * MB

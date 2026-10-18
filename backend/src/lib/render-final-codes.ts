/**
 * The error codes every Render final lane answers with — a leaf module, so the
 * engine and the use-case continuation can name them without importing
 * render-final-run.ts (which loads the use-case resume pricing, and would
 * otherwise close an import cycle through them).
 */

/** A Render final of a render whose take is not a Preview (every Render final lane answers it). */
export const RENDER_FINAL_NOT_PREVIEW = "render_final_not_preview"
/** A Render final asked while one of the same run is under way (or, for a use-case run, done). */
export const RENDER_FINAL_ALREADY_RUNNING = "already_running"

/**
 * The request and response headers the video-editor project routes use
 * (Cloud, `ee/routes/editor-projects*.ts`). ONE list, read by those routes
 * and by the CORS options in `app.ts`: the editor calls the routes from
 * another origin, so a header missing from the preflight's allowed list fails
 * every save, and a response header not exposed is unreadable to the page.
 *
 * Plain names in core, so core's CORS imports nothing from `ee/`. They are
 * allowed on every edition: harmless where the routes do not exist.
 */
export const HOLDER_HEADER = "x-holder"
export const CONTENT_HASH_HEADER = "x-content-hash"
export const BASE_HASH_HEADER = "x-base-hash"
export const CUT_VERSION_HEADER = "x-cut-version"
export const REVISION_HEADER = "x-revision"
export const VERSION_HEADER = "x-version"

/** Request headers a cross-origin editor sends to the file routes. */
export const EDITOR_PROJECT_REQUEST_HEADERS = [HOLDER_HEADER, CONTENT_HASH_HEADER, BASE_HASH_HEADER, CUT_VERSION_HEADER] as const

/** Response headers a cross-origin editor must be able to read. */
export const EDITOR_PROJECT_EXPOSED_HEADERS = [REVISION_HEADER, VERSION_HEADER] as const

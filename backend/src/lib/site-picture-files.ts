// @reads-none checks only build output (frontend/dist, untracked) or a directory its caller passes
import { statSync } from "node:fs"
import { join } from "node:path"
import { sitePictureFile } from "./site-picture-path.js"
import { FRONTEND_BUILD_DIR } from "./surface-strings.js"

/**
 * The boot's check that every picture a deployment named as a path on its site
 * (lib/site-picture-path.ts) is a file of the site's build. The overlay loader
 * runs it once register() has returned and the other picture checks passed
 * (lib/overlay/load.ts).
 *
 * The backend can only look where it sees the built site: the standard image
 * puts the frontend's build (`/app/frontend/dist`, the directory the bundled
 * proxy serves the site from) beside the backend's on one filesystem, and this
 * reads it there (`frontend/dist` beside `backend/`, as lib/surface-strings.ts
 * does). With no build there — a local dev run, or a service image without the
 * frontend — nothing is checked and the loader says so in one line: the
 * deployment's own build must then check each path against the files it ships.
 */

export interface SitePicture {
  /** Where it was registered, for the message (`"style/noir" pictureUrl`). */
  readonly where: string
  readonly path: string
}

/** Where the backend looks for the built site by default. */
export const DEFAULT_SITE_DIRECTORY = FRONTEND_BUILD_DIR

/** The built site's directory when it holds a build (its `index.html`), else null. */
export function servedSiteDirectory(dir: string = DEFAULT_SITE_DIRECTORY): string | null {
  try {
    return statSync(join(dir, "index.html")).isFile() ? dir : null
  } catch {
    return null
  }
}

/**
 * One line per picture whose path names no file under `dir` (decoded once, as
 * the proxy looks it up), or empty. The paths were judged by the site-path
 * rule at registration, so none climbs out of `dir`.
 */
export function sitePictureFileProblems(pictures: readonly SitePicture[], dir: string): string[] {
  return pictures.flatMap(({ where, path }) => {
    const file = join(dir, sitePictureFile(path))
    let isFile = false
    try {
      isFile = statSync(file).isFile()
    } catch {
      /* missing or unreadable: not a file the site serves */
    }
    return isFile ? [] : [`${where} ${JSON.stringify(path)} is not a file of the built site (${file})`]
  })
}

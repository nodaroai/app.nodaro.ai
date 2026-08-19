import pkg from "../../package.json"

/**
 * The running app's version. Published images bake the release tag in as
 * VITE_APP_VERSION (community-image.yml passes the vX.Y.Z tag app-release put
 * on the commit); dev servers and builds outside the release pipeline fall
 * back to package.json. package.json is NOT the source of truth — it sat at
 * 1.23.0 for six months while 5,882 commits shipped (the release pipeline
 * derives versions from git tags instead; see the versioning spec).
 */
const baked = (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim()

export const APP_VERSION: string = baked || pkg.version

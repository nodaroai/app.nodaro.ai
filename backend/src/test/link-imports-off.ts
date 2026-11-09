/**
 * Turns a deployment's link-import switch off (`imports.links: false`) for the
 * surrounding describe block, with `https://cdn.nodaro.test` as this
 * deployment's own storage, the way an operator's surface profile would.
 */
import { afterEach, beforeEach } from "vitest"
import { __resetSurfaceProfileCacheForTests } from "../lib/surface-profile.js"

export const OWN_MEDIA_URL = "https://cdn.nodaro.test/uploads/videos/own-file.mp4"

export function withLinkImportsOff(): void {
  const prevProfile = process.env.NODARO_SURFACE_PROFILE
  const prevPublic = process.env.R2_PUBLIC_URL
  beforeEach(() => {
    process.env.R2_PUBLIC_URL = "https://cdn.nodaro.test"
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ imports: { links: false } })
    __resetSurfaceProfileCacheForTests()
  })
  afterEach(() => {
    if (prevProfile === undefined) delete process.env.NODARO_SURFACE_PROFILE
    else process.env.NODARO_SURFACE_PROFILE = prevProfile
    if (prevPublic === undefined) delete process.env.R2_PUBLIC_URL
    else process.env.R2_PUBLIC_URL = prevPublic
    __resetSurfaceProfileCacheForTests()
  })
}

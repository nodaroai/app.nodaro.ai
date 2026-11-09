/**
 * The deployment's switch for links to outside content (`imports.links` on its
 * surface profile, `lib/link-imports.ts`). Absent means today's behaviour; a
 * deployment that sets it to false refuses every link to outside content, and
 * a file of the deployment's own storage is not a link to outside content.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { config } from "../config.js"
import { __resetSurfaceProfileCacheForTests, surfaceAllowsLinkImports } from "../surface-profile.js"
import { LinkImportsDisabledError, assertLinkImportAllowed, isOutsideLink, linkImportRefusal } from "../link-imports.js"

const OWN = "https://cdn.nodaro.test/images/4f0e8f3e-7f9a-4f3a-9f0e-1b2c3d4e5f60.png"
const FALLBACK = "https://media.nodaro.test/videos/yt-4f0e8f3e.mp4"
const OUTSIDE = "https://example.com/video.mp4"

function setProfile(profile: unknown): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

describe("link imports switch", () => {
  const prevEdition = config.EDITION
  const prevPublic = process.env.R2_PUBLIC_URL
  const prevFallback = process.env.R2_PUBLIC_FALLBACK_DOMAIN
  const prevProfile = process.env.NODARO_SURFACE_PROFILE

  beforeEach(() => {
    config.EDITION = "business"
    process.env.R2_PUBLIC_URL = "https://cdn.nodaro.test"
    process.env.R2_PUBLIC_FALLBACK_DOMAIN = "media.nodaro.test"
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
  })

  afterEach(() => {
    config.EDITION = prevEdition
    if (prevPublic === undefined) delete process.env.R2_PUBLIC_URL
    else process.env.R2_PUBLIC_URL = prevPublic
    if (prevFallback === undefined) delete process.env.R2_PUBLIC_FALLBACK_DOMAIN
    else process.env.R2_PUBLIC_FALLBACK_DOMAIN = prevFallback
    if (prevProfile === undefined) delete process.env.NODARO_SURFACE_PROFILE
    else process.env.NODARO_SURFACE_PROFILE = prevProfile
    __resetSurfaceProfileCacheForTests()
  })

  describe("surfaceAllowsLinkImports", () => {
    it("allows when no profile is set, or when the profile leaves `imports` out", () => {
      expect(surfaceAllowsLinkImports()).toBe(true)
      setProfile({ brand: { productName: "Acme" } })
      expect(surfaceAllowsLinkImports()).toBe(true)
    })

    it("allows when `imports.links` is true, refuses when it is false", () => {
      setProfile({ imports: { links: true } })
      expect(surfaceAllowsLinkImports()).toBe(true)
      setProfile({ imports: { links: false } })
      expect(surfaceAllowsLinkImports()).toBe(false)
    })

    it("a profile on the community edition is ignored, like every surface key", () => {
      config.EDITION = "community"
      setProfile({ imports: { links: false } })
      expect(surfaceAllowsLinkImports()).toBe(true)
    })
  })

  describe("isOutsideLink", () => {
    it("treats this deployment's own storage as not outside", () => {
      expect(isOutsideLink(OWN)).toBe(false)
      expect(isOutsideLink(FALLBACK)).toBe(false)
      expect(isOutsideLink("https://cdn.nodaro.test/uploads/videos/abc.mp4?cb=2-x")).toBe(false)
      // An escape in an own file's path does not make it outside.
      expect(isOutsideLink("https://cdn.nodaro.test/uploads/videos/a%20b.mp4")).toBe(false)
    })

    it("treats any other host as outside", () => {
      expect(isOutsideLink(OUTSIDE)).toBe(true)
      expect(isOutsideLink("https://www.youtube.com/watch?v=abc")).toBe(true)
      expect(isOutsideLink("https://cdn.nodaro.test.evil.example/x.png")).toBe(true)
    })

    it("does not trust a look of being ours that another reader would read differently", () => {
      // A content-network transform can name a remote source: not a file of ours.
      expect(isOutsideLink("https://cdn.nodaro.test/cdn-cgi/image/width=100/https://example.com/x.jpg")).toBe(true)
      expect(isOutsideLink("https://cdn.nodaro.test/%63dn-cgi/image/width=100/https://example.com/x.jpg")).toBe(true)
      expect(isOutsideLink("https://cdn.nodaro.test/images/../cdn-cgi/image/x")).toBe(true)
      // A path that does not decode is not a file of ours.
      expect(isOutsideLink("https://cdn.nodaro.test/uploads/%zz.mp4")).toBe(true)
      // Two parsers would read the host differently.
      expect(isOutsideLink("https://cdn.nodaro.test\\@example.com/x.mp4")).toBe(true)
      // A parse failure is outside, never own.
      expect(isOutsideLink("not a url")).toBe(true)
    })
  })

  describe("assertLinkImportAllowed / linkImportRefusal", () => {
    it("passes everything while the switch is on", () => {
      expect(() => assertLinkImportAllowed(OUTSIDE)).not.toThrow()
      expect(linkImportRefusal(OUTSIDE)).toBeNull()
    })

    describe("with the switch off", () => {
      beforeEach(() => setProfile({ imports: { links: false } }))

      it("refuses a link to outside content with the one refusal", () => {
        expect(() => assertLinkImportAllowed(OUTSIDE)).toThrow(LinkImportsDisabledError)
        try {
          assertLinkImportAllowed(OUTSIDE)
        } catch (e) {
          const err = e as LinkImportsDisabledError
          expect(err.code).toBe("link_imports_disabled")
          expect(err.deterministic).toBe(true)
        }
        expect(linkImportRefusal(OUTSIDE)).toEqual({ code: "link_imports_disabled", message: expect.any(String) })
      })

      it("lets this deployment's own media through", () => {
        expect(() => assertLinkImportAllowed(OWN)).not.toThrow()
        expect(() => assertLinkImportAllowed(FALLBACK)).not.toThrow()
        expect(linkImportRefusal(OWN)).toBeNull()
      })
    })
  })
})

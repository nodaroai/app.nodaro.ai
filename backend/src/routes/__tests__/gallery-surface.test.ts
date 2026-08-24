import { describe, it, expect, afterEach } from "vitest"
import { buildApp } from "../../app.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

/**
 * When the surface hides gallery, the public /v1/gallery route must not be
 * registered — a hidden nav entry over a still-live public route is the
 * decorative-deny bug the spec calls out. The memoized profile is reset between
 * cases (test setup pins EDITION=cloud, so the business+ gate is open).
 */
describe("gallery route registration honours nav.hide", () => {
  afterEach(() => {
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
  })

  it("registers /v1/gallery by default", async () => {
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: "/v1/gallery" })
    expect(res.statusCode).not.toBe(404)
    await app.close()
  }, 30_000)

  it("does not register /v1/gallery when nav hides gallery", async () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nav: { hide: ["gallery"] } })
    __resetSurfaceProfileCacheForTests()
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: "/v1/gallery" })
    expect(res.statusCode).toBe(404)
    await app.close()
  }, 30_000)
})

import { describe, it, expect, afterEach } from "vitest"
import { runtimeSurfaceProfile, SURFACE_PROFILE_DEFAULT } from "../surface-profile"

describe("frontend runtimeSurfaceProfile", () => {
  afterEach(() => {
    delete window.__NODARO_RUNTIME__
  })

  it("returns the stock default when no runtime surface is present", () => {
    expect(runtimeSurfaceProfile()).toEqual(SURFACE_PROFILE_DEFAULT)
  })

  it("merges a partial window surface over the default", () => {
    window.__NODARO_RUNTIME__ = { surface: { nav: { hide: ["gallery"] } } }
    const p = runtimeSurfaceProfile()
    expect(p.nav.hide).toEqual(["gallery"])
    expect(p.outputs.allowPublic).toBe(true) // untouched default survives
    expect(p.brand.productName).toBe("Nodaro")
  })
})

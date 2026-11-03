import { describe, expect, it } from "vitest"
import { __isPublicRouteForTest as isPublicRoute, isAnonymousRoute } from "../auth.js"

describe("whether a Nodaro Motion page shows its Advanced options is public", () => {
  it("GET /v1/cast-swap/advanced takes no credential, and nothing else under /v1/cast-swap does", () => {
    expect(isPublicRoute("GET", "/v1/cast-swap/advanced")).toBe(true)
    expect(isAnonymousRoute("GET", "/v1/cast-swap/advanced")).toBe(true)
    expect(isPublicRoute("GET", "/v1/cast-swap/advanced?x=1")).toBe(true)

    expect(isPublicRoute("POST", "/v1/cast-swap/advanced")).toBe(false)
    expect(isPublicRoute("PUT", "/v1/cast-swap/advanced")).toBe(false)
    expect(isPublicRoute("GET", "/v1/cast-swap/advancedX")).toBe(false)
    expect(isPublicRoute("GET", "/v1/cast-swap/advanced/motion-prism")).toBe(false)
    // Its neighbours stay behind a credential, the admin's switch among them.
    expect(isPublicRoute("POST", "/v1/cast-swap")).toBe(false)
    expect(isPublicRoute("POST", "/v1/cast-swap/estimate")).toBe(false)
    expect(isPublicRoute("GET", "/v1/cast-swap")).toBe(false)
    expect(isPublicRoute("POST", "/v1/cast-swap/job-1/full-quality")).toBe(false)
    expect(isPublicRoute("GET", "/v1/admin/nodaro-motion/advanced")).toBe(false)
    expect(isPublicRoute("PUT", "/v1/admin/nodaro-motion/advanced")).toBe(false)
  })
})

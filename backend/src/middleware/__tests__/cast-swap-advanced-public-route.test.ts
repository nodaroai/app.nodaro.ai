import { describe, expect, it } from "vitest"
import { __isPublicRouteForTest as isPublicRoute, isAnonymousRoute } from "../auth.js"

describe("whether a Video Remake page shows its Advanced options is public", () => {
  it("GET /v1/cast-swap/advanced takes no credential, and nothing else under /v1/cast-swap does", () => {
    expect(isPublicRoute("GET", "/v1/cast-swap/advanced")).toBe(true)
    expect(isAnonymousRoute("GET", "/v1/cast-swap/advanced")).toBe(true)
    expect(isPublicRoute("GET", "/v1/cast-swap/advanced?x=1")).toBe(true)

    expect(isPublicRoute("POST", "/v1/cast-swap/advanced")).toBe(false)
    expect(isPublicRoute("PUT", "/v1/cast-swap/advanced")).toBe(false)
    expect(isPublicRoute("GET", "/v1/cast-swap/advancedX")).toBe(false)
    expect(isPublicRoute("GET", "/v1/cast-swap/advanced/nodaro-prism")).toBe(false)
    // Its neighbours stay behind a credential, the admin's switch among them.
    expect(isPublicRoute("POST", "/v1/cast-swap")).toBe(false)
    expect(isPublicRoute("POST", "/v1/cast-swap/estimate")).toBe(false)
    expect(isPublicRoute("GET", "/v1/cast-swap")).toBe(false)
    expect(isPublicRoute("POST", "/v1/cast-swap/job-1/full-quality")).toBe(false)
    expect(isPublicRoute("GET", "/v1/admin/video-remake/advanced")).toBe(false)
    expect(isPublicRoute("PUT", "/v1/admin/video-remake/advanced")).toBe(false)
  })

  it("GET /v1/video-remake/advanced takes no credential either, and nothing else under /v1/video-remake does", () => {
    expect(isPublicRoute("GET", "/v1/video-remake/advanced")).toBe(true)
    expect(isAnonymousRoute("GET", "/v1/video-remake/advanced")).toBe(true)
    for (const [method, url] of [["POST", "/v1/video-remake"], ["POST", "/v1/video-remake/estimate"], ["POST", "/v1/video-remake/advanced"], ["GET", "/v1/video-remake/advanced/x"]]) {
      expect(isPublicRoute(method!, url!), `${method} ${url}`).toBe(false)
    }
  })
})

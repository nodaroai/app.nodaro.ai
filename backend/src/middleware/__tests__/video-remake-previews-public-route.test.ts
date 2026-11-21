import { describe, expect, it } from "vitest"
import { __isPublicRouteForTest as isPublicRoute, isAnonymousRoute } from "../auth.js"

describe("Video Remake's previews are public", () => {
  it("GET /v1/video-remake/previews takes no credential, in any language, and nothing below it does", () => {
    expect(isPublicRoute("GET", "/v1/video-remake/previews")).toBe(true)
    expect(isAnonymousRoute("GET", "/v1/video-remake/previews")).toBe(true)
    expect(isPublicRoute("GET", "/v1/video-remake/previews?locale=he")).toBe(true)

    for (const [method, url] of [
      ["POST", "/v1/video-remake/previews"],
      ["PUT", "/v1/video-remake/previews"],
      ["GET", "/v1/video-remake/previewsX"],
      ["GET", "/v1/video-remake/previews/restyle"],
      ["POST", "/v1/video-remake"],
      ["POST", "/v1/video-remake/estimate"],
    ]) {
      expect(isPublicRoute(method!, url!), `${method} ${url}`).toBe(false)
    }
  })

  it("its /v1/cast-swap alias takes no credential either", () => {
    expect(isPublicRoute("GET", "/v1/cast-swap/previews")).toBe(true)
    expect(isAnonymousRoute("GET", "/v1/cast-swap/previews")).toBe(true)
    expect(isPublicRoute("GET", "/v1/cast-swap/previews?locale=ja")).toBe(true)
    for (const [method, url] of [["POST", "/v1/cast-swap/previews"], ["GET", "/v1/cast-swap/previews/restyle"], ["GET", "/v1/cast-swap"], ["POST", "/v1/cast-swap"]]) {
      expect(isPublicRoute(method!, url!), `${method} ${url}`).toBe(false)
    }
  })
})

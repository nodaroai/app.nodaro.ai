import { describe, expect, it } from "vitest"
import { __isPublicRouteForTest as isPublicRoute, isAnonymousRoute } from "../auth.js"

describe("Video Remake's art styles are public", () => {
  it("GET /v1/video-remake/art-styles takes no credential, in any language, and nothing below it does", () => {
    expect(isPublicRoute("GET", "/v1/video-remake/art-styles")).toBe(true)
    expect(isAnonymousRoute("GET", "/v1/video-remake/art-styles")).toBe(true)
    expect(isPublicRoute("GET", "/v1/video-remake/art-styles?locale=he")).toBe(true)

    for (const [method, url] of [
      ["POST", "/v1/video-remake/art-styles"],
      ["PUT", "/v1/video-remake/art-styles"],
      ["GET", "/v1/video-remake/art-stylesX"],
      ["GET", "/v1/video-remake/art-styles/anime"],
      ["POST", "/v1/video-remake"],
      ["POST", "/v1/video-remake/estimate"],
    ]) {
      expect(isPublicRoute(method!, url!), `${method} ${url}`).toBe(false)
    }
  })

  it("its /v1/cast-swap alias takes no credential either", () => {
    expect(isPublicRoute("GET", "/v1/cast-swap/art-styles")).toBe(true)
    expect(isAnonymousRoute("GET", "/v1/cast-swap/art-styles")).toBe(true)
    expect(isPublicRoute("GET", "/v1/cast-swap/art-styles?locale=ja")).toBe(true)
    for (const [method, url] of [["POST", "/v1/cast-swap/art-styles"], ["GET", "/v1/cast-swap/art-styles/anime"], ["GET", "/v1/cast-swap"], ["POST", "/v1/cast-swap"]]) {
      expect(isPublicRoute(method!, url!), `${method} ${url}`).toBe(false)
    }
  })
})

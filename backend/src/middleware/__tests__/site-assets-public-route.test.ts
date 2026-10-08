import { describe, expect, it } from "vitest"
import { __isPublicRouteForTest as isPublicRoute } from "../auth.js"

describe("past builds' styling files are public, like the site's own /assets", () => {
  it("GET and HEAD under /v1/site-assets/ — nothing else", () => {
    expect(isPublicRoute("GET", "/v1/site-assets/assets/index-Dz56B_55.css")).toBe(true)
    expect(isPublicRoute("HEAD", "/v1/site-assets/assets/index-Dz56B_55.css")).toBe(true)
    expect(isPublicRoute("POST", "/v1/site-assets/assets/index-Dz56B_55.css")).toBe(false)
    expect(isPublicRoute("GET", "/v1/site-assetsX")).toBe(false)
  })
})

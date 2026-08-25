import { describe, it, expect } from "vitest"
import { __isPublicRouteForTest as isPublicRoute } from "../auth.js"

describe("SSO public-route matching", () => {
  it("treats GET /v1/sso/:provider and /v1/sso/providers as public", () => {
    expect(isPublicRoute("GET", "/v1/sso/librechat")).toBe(true)
    expect(isPublicRoute("GET", "/v1/sso/providers")).toBe(true)
    expect(isPublicRoute("GET", "/v1/sso/librechat?assertion=x")).toBe(true)
  })
  it("does NOT make POST under /v1/sso public", () => {
    expect(isPublicRoute("POST", "/v1/sso/librechat")).toBe(false)
  })
  it("does NOT match a lookalike prefix without the slash", () => {
    expect(isPublicRoute("GET", "/v1/ssoX")).toBe(false)
  })
})

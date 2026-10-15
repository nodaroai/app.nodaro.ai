import { describe, expect, it } from "vitest"
import { __isPublicRouteForTest as isPublicRoute, isAnonymousRoute } from "../auth.js"

describe("the plans list is public pricing data", () => {
  it("GET /v1/billing/plans takes no credential, and nothing else around it does", () => {
    expect(isPublicRoute("GET", "/v1/billing/plans")).toBe(true)
    expect(isAnonymousRoute("GET", "/v1/billing/plans")).toBe(true)
    expect(isPublicRoute("GET", "/v1/billing/plans?x=1")).toBe(true)

    expect(isPublicRoute("POST", "/v1/billing/plans")).toBe(false)
    expect(isPublicRoute("GET", "/v1/billing/plansX")).toBe(false)
    expect(isPublicRoute("GET", "/v1/billing/plans/basic")).toBe(false)
    // Its neighbours stay behind a credential.
    expect(isPublicRoute("GET", "/v1/billing/subscription")).toBe(false)
    expect(isPublicRoute("GET", "/v1/billing/account")).toBe(false)
  })
})

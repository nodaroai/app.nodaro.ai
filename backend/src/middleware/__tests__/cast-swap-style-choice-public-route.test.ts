import { describe, expect, it } from "vitest"
import { __isPublicRouteForTest as isPublicRoute, isAnonymousRoute } from "../auth.js"

describe("Nodaro Motion's Style choice is public", () => {
  it("GET /v1/cast-swap/style-choice takes no credential, and nothing else under /v1/cast-swap does", () => {
    expect(isPublicRoute("GET", "/v1/cast-swap/style-choice")).toBe(true)
    expect(isAnonymousRoute("GET", "/v1/cast-swap/style-choice")).toBe(true)
    expect(isPublicRoute("GET", "/v1/cast-swap/style-choice?x=1")).toBe(true)

    expect(isPublicRoute("POST", "/v1/cast-swap/style-choice")).toBe(false)
    expect(isPublicRoute("GET", "/v1/cast-swap/style-choiceX")).toBe(false)
    expect(isPublicRoute("GET", "/v1/cast-swap/style-choice/motion-prism")).toBe(false)
    // Its neighbours stay behind a credential.
    expect(isPublicRoute("POST", "/v1/cast-swap")).toBe(false)
    expect(isPublicRoute("POST", "/v1/cast-swap/estimate")).toBe(false)
    expect(isPublicRoute("GET", "/v1/cast-swap")).toBe(false)
    expect(isPublicRoute("POST", "/v1/cast-swap/job-1/full-quality")).toBe(false)
  })
})

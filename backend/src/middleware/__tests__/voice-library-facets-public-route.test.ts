import { describe, expect, it } from "vitest"
import { __isPublicRouteForTest as isPublicRoute, isAnonymousRoute } from "../auth.js"

describe("the voice library's facet counts are public, like the listing", () => {
  it("GET /v1/voices/library/facets takes no bearer: a picker shows the counts before anyone signs in", () => {
    expect(isPublicRoute("GET", "/v1/voices/library/facets")).toBe(true)
    expect(isPublicRoute("GET", "/v1/voices/library/facets?use_cases=advertisement&language=he")).toBe(true)
    expect(isAnonymousRoute("GET", "/v1/voices/library/facets")).toBe(true)
    // The listing it counts stays public too.
    expect(isPublicRoute("GET", "/v1/voices/library")).toBe(true)
  })

  it("and nothing else beside it", () => {
    expect(isPublicRoute("POST", "/v1/voices/library/facets")).toBe(false)
    expect(isPublicRoute("GET", "/v1/voices/library/facets/x")).toBe(false)
    expect(isPublicRoute("GET", "/v1/voices/library/facetsX")).toBe(false)
    expect(isPublicRoute("GET", "/v1/voices/favorites")).toBe(false)
  })
})

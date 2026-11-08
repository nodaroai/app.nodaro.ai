import { describe, expect, it } from "vitest"
import { __isPublicRouteForTest as isPublicRoute, isAnonymousRoute } from "../auth.js"

describe("a voice's same-site preview is public", () => {
  it("GET /v1/voices/:voiceId/preview takes no bearer: an <audio src> cannot send one, and its signed address is checked by the route", () => {
    expect(isPublicRoute("GET", "/v1/voices/21m00Tcm4TlvDq8ikWAM/preview")).toBe(true)
    expect(isPublicRoute("GET", "/v1/voices/Rachel/preview?src=aHR0cHM6Ly94&sig=abc")).toBe(true)
    expect(isAnonymousRoute("GET", "/v1/voices/Rachel/preview")).toBe(true)
    // Fastify answers HEAD on the same route: a probe reads headers only.
    expect(isPublicRoute("HEAD", "/v1/voices/Rachel/preview?src=aHR0cHM6Ly94&sig=abc")).toBe(true)
  })

  it("and nothing else beside it", () => {
    expect(isPublicRoute("POST", "/v1/voices/Rachel/preview")).toBe(false)
    expect(isPublicRoute("GET", "/v1/voices/Rachel/preview/x")).toBe(false)
    expect(isPublicRoute("GET", "/v1/voices/a/b/preview")).toBe(false)
    expect(isPublicRoute("GET", "/v1/voices/../preview")).toBe(false)
    expect(isPublicRoute("GET", `/v1/voices/${"a".repeat(65)}/preview`)).toBe(false)
    expect(isPublicRoute("GET", "/v1/voices/Rachel/previewX")).toBe(false)
    // The neighbouring voice routes that take a credential still do.
    expect(isPublicRoute("GET", "/v1/voice-clones")).toBe(false)
    expect(isPublicRoute("POST", "/v1/voices")).toBe(false)
  })
})

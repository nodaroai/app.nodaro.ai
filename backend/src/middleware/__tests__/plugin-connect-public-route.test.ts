import { describe, it, expect } from "vitest"
import { __isPublicRouteForTest as isPublicRoute } from "../auth.js"

/**
 * The plugin connect handshake is driven by a plugin that has no session yet
 * and by a browser landing from the consent screen — none of the three routes
 * can require auth. The poll route matches by prefix (the session id is a
 * path segment); the trailing slash keeps lookalikes out.
 */
describe("plugin connect public routes", () => {
  it("opens the session, the callback, the code confirmation and the poll without auth", () => {
    expect(isPublicRoute("POST", "/v1/oauth/plugin/session")).toBe(true)
    expect(isPublicRoute("GET", "/v1/oauth/plugin/callback?code=x&state=pcs_y")).toBe(true)
    expect(isPublicRoute("POST", "/v1/oauth/plugin/confirm")).toBe(true)
    expect(isPublicRoute("GET", "/v1/oauth/plugin/session/pcs_abc123")).toBe(true)
  })

  it("does not make other methods under the prefix public", () => {
    expect(isPublicRoute("POST", "/v1/oauth/plugin/session/pcs_abc123")).toBe(false)
    expect(isPublicRoute("DELETE", "/v1/oauth/plugin/session/pcs_abc123")).toBe(false)
    expect(isPublicRoute("POST", "/v1/oauth/plugin/callback")).toBe(false)
    expect(isPublicRoute("GET", "/v1/oauth/plugin/confirm")).toBe(false)
  })

  it("does not match a lookalike prefix without the slash", () => {
    expect(isPublicRoute("GET", "/v1/oauth/plugin/sessionX")).toBe(false)
    expect(isPublicRoute("GET", "/v1/oauth/plugin/session")).toBe(false)
  })
})

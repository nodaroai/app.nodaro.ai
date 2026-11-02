/**
 * The public complaints form takes no credential: a complainant has no
 * account here. Exactly the three routes, and only their methods; the rest
 * of /v1 stays behind a credential.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("Invalid token") }) },
  },
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))

import { __isPublicRouteForTest as isPublicRoute, isAnonymousRoute } from "../auth.js"

describe("the public-route matcher", () => {
  it("the statements, the submission and the verify link take no credential", () => {
    expect(isPublicRoute("GET", "/v1/content-complaints/statements")).toBe(true)
    expect(isPublicRoute("POST", "/v1/content-complaints")).toBe(true)
    expect(isPublicRoute("GET", `/v1/content-complaints/verify?token=${"a".repeat(64)}`)).toBe(true)
    expect(isAnonymousRoute("POST", "/v1/content-complaints")).toBe(true)
  })

  it("no other method or path under it does", () => {
    expect(isPublicRoute("GET", "/v1/content-complaints")).toBe(false)
    expect(isPublicRoute("POST", "/v1/content-complaints/verify")).toBe(false)
    expect(isPublicRoute("GET", "/v1/content-complaints/c-1")).toBe(false)
    expect(isPublicRoute("DELETE", "/v1/content-complaints")).toBe(false)
  })
})

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createSharedSupabaseClient } from "../supabase-browser.js"

/**
 * jsdom 27 removed Web Storage (deferring to Node's experimental
 * localStorage, which is absent without --localstorage-file), so tests
 * provide the browser reality via a minimal in-memory Storage stub.
 */
class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v))
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
  clear() {
    this.m.clear()
  }
}

const URL_A = "https://testref.supabase.co"
const ANON = "test-anon-key"
const LEGACY_KEY = "sb-testref-auth-token"

/** Unsigned JWT with a controlled exp — auth-js only decodes, never verifies. */
function fakeJwt(expSecondsFromNow: number): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
  const now = Math.floor(Date.now() / 1000)
  return `${b64({ alg: "none" })}.${b64({ sub: "user-1", exp: now + expSecondsFromNow, role: "authenticated" })}.sig`
}

function legacySession(expSecondsFromNow = 3600) {
  return {
    access_token: fakeJwt(expSecondsFromNow),
    refresh_token: "refresh-abc",
    token_type: "bearer",
    user: { id: "user-1" },
  }
}

/**
 * Minimal GoTrue emulation so setSession stays hermetic: 200 on /user
 * (token validation), 400 on /token (refresh of dead tokens — an HTTP
 * error, not a network reject, so auth-js fails fast instead of retrying).
 */
function stubAuthFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input)
      if (u.includes("/auth/v1/user")) {
        return new Response(
          JSON.stringify({ id: "user-1", aud: "authenticated", email: "u@example.com" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }
      if (u.includes("/auth/v1/token")) {
        return new Response(
          JSON.stringify({ error: "invalid_grant", error_description: "refresh token dead" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
      }
      return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } })
    })
  )
}

function clearCookies() {
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0]?.trim()
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemStorage())
})

afterEach(() => {
  clearCookies()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("createSharedSupabaseClient", () => {
  it("returns no session when there is nothing stored", async () => {
    const client = createSharedSupabaseClient({ url: URL_A, anonKey: ANON })
    const { data } = await client.auth.getSession()
    expect(data.session).toBeNull()
  })

  it("adopts a legacy localStorage session into cookies and removes the key", async () => {
    stubAuthFetch()
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacySession()))
    const client = createSharedSupabaseClient({
      url: URL_A,
      anonKey: ANON,
      cookieDomain: ".nodaro.ai", // jsdom runs on localhost → must NOT be applied
    })
    const { data } = await client.auth.getSession()
    expect(data.session?.user?.id).toBe("user-1")
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
    expect(document.cookie).toContain("sb-testref-auth-token")
  })

  it("discards a corrupt legacy value and reports signed-out", async () => {
    localStorage.setItem(LEGACY_KEY, "{not-json")
    const client = createSharedSupabaseClient({ url: URL_A, anonKey: ANON })
    const { data } = await client.auth.getSession()
    expect(data.session).toBeNull()
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it("discards a legacy session whose tokens are dead (refresh fails)", async () => {
    stubAuthFetch() // expired access → refresh attempt → 400 → discarded
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacySession(-60))) // expired
    const client = createSharedSupabaseClient({ url: URL_A, anonKey: ANON })
    const { data } = await client.auth.getSession()
    expect(data.session).toBeNull()
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  })
})

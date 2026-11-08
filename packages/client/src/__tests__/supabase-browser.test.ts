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

/** Vitest's jsdom environment exposes its JSDOM instance as `jsdom`. */
const dom = (
  globalThis as unknown as {
    jsdom: {
      reconfigure(settings: { url: string }): void
      cookieJar: { removeAllCookiesSync(): void }
    }
  }
).jsdom
const START_URL = location.href

/** The names of the cookies this page can read; a name set on two scopes appears twice. */
function cookieNames(): string[] {
  return document.cookie
    .split(";")
    .map((c) => c.split("=")[0]?.trim() ?? "")
    .filter(Boolean)
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemStorage())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  // Every cookie, whatever its domain or Secure flag, and the page back on
  // localhost, even when a test failed halfway.
  dom.cookieJar.removeAllCookiesSync()
  dom.reconfigure({ url: START_URL })
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

describe("createSharedSupabaseClient retiredSupabaseUrls", () => {
  const RETIRED_URL = "https://oldref.supabase.co"
  const RETIRED_KEY = "sb-oldref-auth-token"
  /** Everything supabase-js can leave under a project's prefix. */
  const RETIRED_NAMES = [
    `${RETIRED_KEY}.0`,
    `${RETIRED_KEY}.1`,
    `${RETIRED_KEY}-code-verifier`,
    `${RETIRED_KEY}-flow-f1-code-verifier`,
    `${RETIRED_KEY}-flows-code-verifier`,
    `${RETIRED_KEY}-user`,
  ]

  /** Spies on the cookie setter; the writes still reach the jar. */
  function spyOnCookieWrites() {
    return vi.spyOn(document, "cookie", "set")
  }

  /** The recorded cookie writes whose name starts with `prefix`. */
  function writesUnder(spy: ReturnType<typeof spyOnCookieWrites>, prefix: string): string[] {
    return spy.mock.calls.map(([value]) => String(value)).filter((value) => value.startsWith(prefix))
  }

  it("deletes every cookie a retired project left: session chunks, code verifiers, flow slots, user", () => {
    for (const name of RETIRED_NAMES) document.cookie = `${name}=x; Path=/`
    const writes = spyOnCookieWrites()
    createSharedSupabaseClient({
      url: URL_A,
      anonKey: ANON,
      cookieDomain: ".nodaro.ai", // jsdom runs on localhost → host-only deletes only
      retiredSupabaseUrls: [RETIRED_URL],
    })
    expect(cookieNames().filter((name) => name.startsWith("sb-oldref-"))).toEqual([])
    expect(writesUnder(writes, "sb-oldref-")).toEqual(
      RETIRED_NAMES.map((name) => `${name}=; Path=/; Max-Age=0; SameSite=lax`)
    )
  })

  it("keeps the current project's cookies and unrelated ones", () => {
    const kept = [
      `${LEGACY_KEY}.0`,
      `${LEGACY_KEY}-code-verifier`,
      "sb-otherref-auth-token",
      "sb-oldrefx-auth-token", // another project whose ref merely starts the same
      "theme",
    ]
    for (const name of [...kept, `${RETIRED_KEY}.0`]) document.cookie = `${name}=x; Path=/`
    createSharedSupabaseClient({ url: URL_A, anonKey: ANON, retiredSupabaseUrls: [RETIRED_URL] })
    expect(cookieNames().sort()).toEqual([...kept].sort())
  })

  it("ignores the current project's URL when it is listed as retired", () => {
    document.cookie = `${LEGACY_KEY}.0=x; Path=/`
    document.cookie = `${LEGACY_KEY}-code-verifier=x; Path=/`
    document.cookie = `${RETIRED_KEY}.0=x; Path=/`
    const writes = spyOnCookieWrites()
    createSharedSupabaseClient({
      url: URL_A,
      anonKey: ANON,
      retiredSupabaseUrls: [URL_A, RETIRED_URL],
    })
    expect(writesUnder(writes, "sb-testref-")).toEqual([])
    expect(cookieNames()).toEqual([`${LEGACY_KEY}.0`, `${LEGACY_KEY}-code-verifier`])
  })

  it("keeps the current project's cookies when a retired ref is a prefix of its own", () => {
    document.cookie = "sb-auth-eu-auth-token.0=x; Path=/" // current: auth-eu
    document.cookie = "sb-auth-auth-token.0=x; Path=/" // retired: auth
    createSharedSupabaseClient({
      url: "https://auth-eu.example.com",
      anonKey: ANON,
      retiredSupabaseUrls: ["https://auth.example.com"],
    })
    expect(cookieNames()).toEqual(["sb-auth-eu-auth-token.0"])
  })

  it("deletes both the cookie-domain and the host-only variant, with the client's attributes", () => {
    dom.reconfigure({ url: "https://app.nodaro.ai/" })
    document.cookie = `${RETIRED_KEY}.0=on-domain; Domain=.nodaro.ai; Path=/; Secure; SameSite=Lax`
    document.cookie = `${RETIRED_KEY}.0=host-only; Path=/; Secure; SameSite=Lax`
    expect(cookieNames().filter((name) => name === `${RETIRED_KEY}.0`)).toHaveLength(2)

    const writes = spyOnCookieWrites()
    createSharedSupabaseClient({
      url: URL_A,
      anonKey: ANON,
      cookieDomain: ".nodaro.ai",
      retiredSupabaseUrls: [RETIRED_URL],
    })
    expect(writesUnder(writes, "sb-oldref-")).toEqual([
      `${RETIRED_KEY}.0=; Domain=.nodaro.ai; Path=/; Max-Age=0; SameSite=lax; Secure`,
      `${RETIRED_KEY}.0=; Path=/; Max-Age=0; SameSite=lax; Secure`,
    ])
    expect(cookieNames()).not.toContain(`${RETIRED_KEY}.0`)
  })

  it("ignores a retired URL that does not parse", () => {
    document.cookie = `${RETIRED_KEY}.0=x; Path=/`
    document.cookie = `${LEGACY_KEY}.0=x; Path=/`
    expect(() =>
      createSharedSupabaseClient({
        url: URL_A,
        anonKey: ANON,
        retiredSupabaseUrls: ["not a url", "", "mailto:someone", RETIRED_URL],
      })
    ).not.toThrow()
    expect(cookieNames()).toEqual([`${LEGACY_KEY}.0`])
  })

  it("does nothing without a document", () => {
    document.cookie = `${RETIRED_KEY}.0=x; Path=/`
    const writes = spyOnCookieWrites()
    vi.stubGlobal("document", undefined)
    expect(() =>
      createSharedSupabaseClient({ url: URL_A, anonKey: ANON, retiredSupabaseUrls: [RETIRED_URL] })
    ).not.toThrow()
    vi.unstubAllGlobals()
    expect(writes).not.toHaveBeenCalled()
    expect(cookieNames()).toEqual([`${RETIRED_KEY}.0`])
  })
})

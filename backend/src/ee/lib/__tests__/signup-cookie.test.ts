import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/config.js", () => ({ config: { INTERNAL_ORCHESTRATOR_SECRET: "x".repeat(40) } }))

import { cookieKeyOf, mintSignupCookie, readCookie, signupCookieHeader, signupCookieKey, SIGNUP_COOKIE_NAME, verifySignupCookie } from "../signup-cookie.js"

const HEX64 = /^[0-9a-f]{64}$/

function fakeReq(headers: Record<string, string> = {}) {
  return { headers: { host: "app.nodaro.ai", ...headers } } as never
}
function fakeReply() {
  const headers: Record<string, unknown> = {}
  return {
    headers,
    getHeader: (k: string) => headers[k.toLowerCase()],
    header(k: string, v: unknown) {
      headers[k.toLowerCase()] = v
      return this
    },
  }
}

describe("the signed signup cookie", () => {
  it("a minted value verifies back to its id, and every id is new", () => {
    const a = mintSignupCookie()
    const b = mintSignupCookie()
    expect(verifySignupCookie(a.value)).toBe(a.id)
    expect(a.id).not.toBe(b.id)
  })

  it("an altered, forged, malformed or foreign value is absent", () => {
    const { value, id } = mintSignupCookie()
    const [v, , sig] = value.split(".")
    expect(verifySignupCookie(`${v}.${"0".repeat(32)}.${sig}`)).toBeNull()
    expect(verifySignupCookie(`${v}.${id}.${"0".repeat(32)}`)).toBeNull()
    expect(verifySignupCookie(`v2.${id}.${sig}`)).toBeNull()
    for (const junk of ["", "abc", "v1..", null, undefined]) expect(verifySignupCookie(junk)).toBeNull()
  })

  it("stores a keyed hash of the id, never the id, and the same id always hashes the same", () => {
    const { id } = mintSignupCookie()
    expect(cookieKeyOf(id)).toMatch(HEX64)
    expect(cookieKeyOf(id)).toBe(cookieKeyOf(id))
    expect(cookieKeyOf(id)).not.toContain(id)
  })

  it("reads the named cookie out of a header with others around it", () => {
    expect(readCookie(`a=1; ${SIGNUP_COOKIE_NAME}=v1.x.y; b=2`, SIGNUP_COOKIE_NAME)).toBe("v1.x.y")
    expect(readCookie("a=1", SIGNUP_COOKIE_NAME)).toBeNull()
    expect(readCookie(undefined, SIGNUP_COOKIE_NAME)).toBeNull()
  })

  it("is HttpOnly, Lax, a year long, Secure except on localhost", () => {
    const h = signupCookieHeader("v", fakeReq())
    expect(h).toContain("HttpOnly")
    expect(h).toContain("SameSite=Lax")
    expect(h).toContain(`Max-Age=${365 * 24 * 60 * 60}`)
    expect(h).toContain("Secure")
    expect(signupCookieHeader("v", fakeReq({ host: "localhost:3000" }))).not.toContain("Secure")
  })
})

describe("signupCookieKey — the claim's cookie", () => {
  it("keeps a browser's existing signed cookie and sets nothing", () => {
    const { value, id } = mintSignupCookie()
    const reply = fakeReply()
    expect(signupCookieKey(fakeReq({ cookie: `${SIGNUP_COOKIE_NAME}=${value}` }), reply as never)).toEqual({ key: cookieKeyOf(id), fresh: false })
    expect(reply.headers["set-cookie"]).toBeUndefined()
  })

  it("gives a browser without one — or with a forged one — a fresh signed cookie", () => {
    for (const cookie of [undefined, `${SIGNUP_COOKIE_NAME}=v1.${"a".repeat(32)}.${"b".repeat(32)}`]) {
      const reply = fakeReply()
      const out = signupCookieKey(fakeReq(cookie ? { cookie } : {}), reply as never)
      expect(out?.fresh).toBe(true)
      expect(out?.key).toMatch(HEX64)
      const set = String(reply.headers["set-cookie"])
      const value = set.split(";")[0]!.split("=")[1]!
      expect(cookieKeyOf(verifySignupCookie(value)!)).toBe(out!.key)
    }
  })
})

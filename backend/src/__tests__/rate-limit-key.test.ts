import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import { rateLimitKeyGenerator } from "../app.js"

const sha = (s: string) => "cred:" + createHash("sha256").update(s).digest("hex")

describe("rateLimitKeyGenerator", () => {
  it("keys authenticated requests by the credential, NOT by X-Forwarded-For", () => {
    const auth = "Bearer eyJhbGciOi.token.sig"
    const key = rateLimitKeyGenerator({
      headers: { authorization: auth, "x-forwarded-for": "1.2.3.4" },
      ip: "10.0.0.1",
    })
    expect(key).toBe(sha(auth))
  })

  it("closes the XFF-spoofing bypass: same token + different XFF => same bucket", () => {
    const auth = "Bearer stolen.jwt"
    const k1 = rateLimitKeyGenerator({
      headers: { authorization: auth, "x-forwarded-for": "1.1.1.1" },
    })
    const k2 = rateLimitKeyGenerator({
      headers: { authorization: auth, "x-forwarded-for": "9.9.9.9" },
    })
    const k3 = rateLimitKeyGenerator({
      headers: { authorization: auth, "x-forwarded-for": "random-spoof-3" },
    })
    expect(k1).toBe(k2)
    expect(k2).toBe(k3)
  })

  it("gives different tokens different buckets", () => {
    const a = rateLimitKeyGenerator({ headers: { authorization: "Bearer a" } })
    const b = rateLimitKeyGenerator({ headers: { authorization: "Bearer b" } })
    expect(a).not.toBe(b)
  })

  it("keys UNauthenticated requests on the client's network (lib/client-address.ts)", () => {
    // Behind the bundled Caddy: one entry, the address Caddy decided.
    expect(
      rateLimitKeyGenerator({ headers: { "x-forwarded-for": "203.0.113.7" }, ip: "127.0.0.1" }),
    ).toBe("203.0.113.7")
  })

  it("a client-chosen leftmost entry cannot pick the bucket", () => {
    // An appending hop leaves the forged value on the left; the address that
    // hop saw (the nearest untrusted one) is what the limiter keys on.
    const key = rateLimitKeyGenerator({
      headers: { "x-forwarded-for": "203.0.113.7, 70.0.0.1" },
      ip: "10.0.0.1",
    })
    expect(key).toBe("70.0.0.1")
  })

  it("falls back to req.ip when neither auth nor XFF is present", () => {
    expect(rateLimitKeyGenerator({ headers: {}, ip: "10.0.0.2" })).toBe("10.0.0.2")
    expect(rateLimitKeyGenerator({ headers: {} })).toBe("unknown")
  })
})

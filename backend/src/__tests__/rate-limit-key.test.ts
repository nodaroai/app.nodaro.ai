import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import Fastify from "fastify"
import rateLimit from "@fastify/rate-limit"
import { rateLimitKeyGenerator } from "../app.js"
import { config } from "../lib/config.js"

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

// An internal request (MCP tool, orchestrator) carries the secret and no
// credential. It used to key on the loopback address, so every MCP user on an
// instance shared ONE bucket (#1888). test/setup.ts sets the secret.
describe("rateLimitKeyGenerator — internal requests (#1888)", () => {
  const SECRET = config.INTERNAL_ORCHESTRATOR_SECRET
  const U1 = "00000000-0000-4000-8000-000000000001"
  const U2 = "00000000-0000-4000-8000-000000000002"
  const internal = (user?: string, secret: string = SECRET) => ({
    headers: {
      "x-internal-orchestrator-secret": secret,
      ...(user !== undefined ? { "x-internal-user-id": user } : {}),
    },
    ip: "127.0.0.1",
  })

  it("keys an internal request on the user it acts for: two users, two buckets", () => {
    expect(rateLimitKeyGenerator(internal(U1))).toBe(`user:${U1}`)
    expect(rateLimitKeyGenerator(internal(U2))).toBe(`user:${U2}`)
  })

  it("an internal request that names no user keeps the address key", () => {
    expect(rateLimitKeyGenerator(internal())).toBe("127.0.0.1")
  })

  it("a forged secret cannot pick a bucket: it falls through to the address key", () => {
    expect(rateLimitKeyGenerator(internal(U1, "f".repeat(64)))).toBe("127.0.0.1")
    expect(rateLimitKeyGenerator(internal(U2, "f".repeat(64)))).toBe("127.0.0.1")
  })

  it("a user header without the secret is ignored", () => {
    expect(rateLimitKeyGenerator({ headers: { "x-internal-user-id": U1 }, ip: "127.0.0.1" })).toBe("127.0.0.1")
  })

  it("a user header that is not a user id is ignored", () => {
    expect(rateLimitKeyGenerator(internal("not-a-user"))).toBe("127.0.0.1")
    expect(rateLimitKeyGenerator(internal(`${U1},${U2}`))).toBe("127.0.0.1")
  })

  it("the internal user wins over an Authorization header, as the auth hook checks the secret first", () => {
    const req = internal(U1)
    expect(rateLimitKeyGenerator({ ...req, headers: { ...req.headers, authorization: "Bearer x" } })).toBe(`user:${U1}`)
  })

  it("a credential request is unchanged", () => {
    expect(rateLimitKeyGenerator({ headers: { authorization: "Bearer a" } })).toBe(sha("Bearer a"))
  })

  it("on a real limited route, one user's burst no longer 429s another user", async () => {
    const app = Fastify()
    await app.register(rateLimit, { global: false, keyGenerator: rateLimitKeyGenerator })
    app.post("/limited", { config: { rateLimit: { max: 2, timeWindow: "1 minute" } } }, async () => ({ ok: true }))
    const post = (user: string) => app.inject({ method: "POST", url: "/limited", headers: internal(user).headers })
    expect((await post(U1)).statusCode).toBe(200)
    expect((await post(U1)).statusCode).toBe(200)
    expect((await post(U1)).statusCode).toBe(429)
    expect((await post(U2)).statusCode).toBe(200)
    await app.close()
  })
})

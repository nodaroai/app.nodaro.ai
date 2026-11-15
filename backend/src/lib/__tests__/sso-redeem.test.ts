import { describe, it, expect, vi, beforeEach } from "vitest"
import { SignJWT } from "jose"

/**
 * `redeemAssertion` is THE redemption of a provider's assertion, for the
 * browser sign-in (GET /v1/sso/:provider) and the MCP assertion exchange
 * (POST /v1/oauth/token, jwt-bearer) alike (decided 2026-11-11): the one
 * verifier, one single-use store shared by both uses (a jti is redeemed once,
 * whichever door it reaches first), the one account resolution
 * (`resolveSsoUser`: the linking rules, the billing-account rule and the
 * operator-address rule) and the access-block check.
 */

const store = vi.hoisted(() => new Map<string, string>())
vi.mock("../queue.js", () => ({
  redis: {
    set: vi.fn(async (key: string, val: string, _ex: string, _ttl: number, nx?: string) => {
      if (nx === "NX" && store.has(key)) return null
      store.set(key, val)
      return "OK"
    }),
  },
}))

const link = vi.hoisted(() => ({ result: null as unknown, calls: [] as unknown[][] }))
vi.mock("../sso-linking.js", () => ({
  resolveSsoUser: vi.fn(async (...args: unknown[]) => {
    link.calls.push(args)
    return link.result
  }),
}))

const blocked = vi.hoisted(() => new Set<string>())
vi.mock("../access-blocks.js", () => ({ isUserBlocked: vi.fn(async (id: string) => blocked.has(id)) }))

import { redeemAssertion } from "../sso-redeem.js"
import { redis } from "../queue.js"
import type { SsoProviderConfig } from "../sso-providers.js"

const SECRET = "test-sso-hmac-secret-not-real-000"
const key = new TextEncoder().encode(SECRET)
const provider: SsoProviderConfig = {
  id: "chat",
  label: "Chat",
  kind: "assertion",
  secret: SECRET,
  audience: "nodaro-sign-in",
  exchangeAudience: "nodaro-mcp-exchange",
  claimMap: { email: "email", emailVerified: "email_verified", subject: "sub" },
  maxLifetimeSeconds: 300,
}

function mint(aud: string, jti: string, opts: { expiresIn?: string; noJti?: boolean } = {}) {
  let b = new SignJWT({ email: "a@example.com", email_verified: true, sub: "idp-1" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setAudience(aud).setExpirationTime(opts.expiresIn ?? "2m")
  if (!opts.noJti) b = b.setJti(jti)
  return b.sign(key)
}

beforeEach(() => {
  store.clear()
  blocked.clear()
  link.calls.length = 0
  link.result = { ok: true, email: "a@example.com", userId: "user-1", action: "provisioned" }
})

describe("redeemAssertion", () => {
  it("a valid assertion: verified, claimed once, resolved through resolveSsoUser", async () => {
    const out = await redeemAssertion(provider, await mint("nodaro-mcp-exchange", "j1"), "exchange")
    expect(out).toEqual({ ok: true, userId: "user-1", email: "a@example.com", action: "provisioned" })
    expect(link.calls).toHaveLength(1)
    expect(link.calls[0]?.[0]).toBe(provider)
    expect(link.calls[0]?.[1]).toMatchObject({ email: "a@example.com", emailVerified: true, subject: "idp-1", jti: "j1" })
  })

  it("a jti is redeemed once across BOTH uses (one store, keyed by provider and jti)", async () => {
    expect((await redeemAssertion(provider, await mint("nodaro-mcp-exchange", "shared"), "exchange")).ok).toBe(true)
    expect(await redeemAssertion(provider, await mint("nodaro-sign-in", "shared"), "sign-in")).toEqual({ ok: false, reason: "replayed" })
    expect((await redeemAssertion(provider, await mint("nodaro-sign-in", "other"), "sign-in")).ok).toBe(true)
    expect(await redeemAssertion(provider, await mint("nodaro-mcp-exchange", "other"), "exchange")).toEqual({ ok: false, reason: "replayed" })
    expect([...store.keys()].sort()).toEqual(["sso:jti:chat:other", "sso:jti:chat:shared"])
  })

  it("an assertion refused by the verifier is never claimed nor resolved", async () => {
    const out = await redeemAssertion(provider, await mint("nodaro-sign-in", "j2"), "exchange")
    expect(out).toMatchObject({ ok: false, reason: "assertion", code: "invalid_claims" })
    expect(store.size).toBe(0)
    expect(link.calls).toHaveLength(0)
    expect(await redeemAssertion(provider, await mint("nodaro-mcp-exchange", "j3", { noJti: true }), "exchange")).toMatchObject({ reason: "assertion", code: "missing_jti" })
    expect(await redeemAssertion(provider, await mint("nodaro-mcp-exchange", "j4", { expiresIn: "1h" }), "exchange")).toMatchObject({ reason: "assertion", code: "too_long_lived" })
  })

  it("a linking refusal carries resolveSsoUser's code and message, and the jti stays spent", async () => {
    link.result = { ok: false, code: "account_exists", message: "An account with this email already exists and is not linked to this identity provider." }
    const out = await redeemAssertion(provider, await mint("nodaro-mcp-exchange", "j5"), "exchange")
    expect(out).toEqual({ ok: false, reason: "link", code: "account_exists", message: "An account with this email already exists and is not linked to this identity provider." })
    expect(store.has("sso:jti:chat:j5")).toBe(true)
  })

  it("a blocked account is refused after it is resolved", async () => {
    blocked.add("user-1")
    expect(await redeemAssertion(provider, await mint("nodaro-mcp-exchange", "j6"), "exchange")).toEqual({ ok: false, reason: "blocked" })
  })

  it("a store that cannot be reached throws: the caller decides, nothing is resolved", async () => {
    vi.mocked(redis.set).mockRejectedValueOnce(new Error("redis down"))
    await expect(redeemAssertion(provider, await mint("nodaro-mcp-exchange", "j7"), "exchange")).rejects.toThrow("redis down")
    expect(link.calls).toHaveLength(0)
  })
})

import { describe, it, expect } from "vitest"
import { SignJWT } from "jose"
import { parseSsoProviders, exchangeProvider, type SsoProviderConfig } from "../sso-providers.js"
import { verifyAssertion } from "../sso-assertion.js"

/**
 * A provider's exchange audience (decided 2026-11-11): the `aud` an assertion
 * carries to be exchanged for an MCP token (POST /v1/oauth/token, the
 * jwt-bearer grant), separate from the `aud` that signs a person in
 * (GET /v1/sso/:provider). A sign-in assertion travels through a browser's
 * address bar, so it must never be exchangeable, and an exchange assertion
 * must never sign anyone in — in both directions, with `aud` a string or an
 * array naming both.
 */

const SECRET = "test-sso-hmac-secret-not-real-000"
const key = new TextEncoder().encode(SECRET)
const base = { id: "chat", label: "Chat", kind: "assertion", secret: SECRET, audience: "nodaro-sign-in" }

function provider(over: Partial<SsoProviderConfig> = {}): SsoProviderConfig {
  return {
    id: "chat",
    label: "Chat",
    kind: "assertion",
    secret: SECRET,
    audience: "nodaro-sign-in",
    exchangeAudience: "nodaro-mcp-exchange",
    claimMap: { email: "email", emailVerified: "email_verified", subject: "sub" },
    maxLifetimeSeconds: 300,
    ...over,
  }
}

function mint(aud: string | string[], jti = "jti-1") {
  return new SignJWT({ email: "a@example.com", email_verified: true, sub: "idp-1" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience(aud)
    .setExpirationTime("2m")
    .setJti(jti)
    .sign(key)
}

describe("EXTERNAL_SSO_PROVIDERS exchangeAudience", () => {
  it("is optional, and absent leaves the provider exactly as before", () => {
    const [p] = parseSsoProviders(JSON.stringify([base]))
    expect(p.exchangeAudience).toBeUndefined()
    expect(exchangeProvider([p])).toBeNull()
  })

  it("is read beside the provider's other settings", () => {
    const [p] = parseSsoProviders(JSON.stringify([{ ...base, exchangeAudience: "nodaro-mcp-exchange" }]))
    expect(p.exchangeAudience).toBe("nodaro-mcp-exchange")
    expect(exchangeProvider([p])?.id).toBe("chat")
  })

  it("STOPS the boot when it equals the sign-in audience (one assertion would do both)", () => {
    expect(() => parseSsoProviders(JSON.stringify([{ ...base, exchangeAudience: "nodaro-sign-in" }]))).toThrow(
      /exchangeAudience must differ from its sign-in "audience"/,
    )
    expect(() => parseSsoProviders(JSON.stringify([{ ...base, exchangeAudience: " nodaro-sign-in" }]))).toThrow(/exchangeAudience/)
  })

  it("STOPS the boot on a provider that is not an assertion provider", () => {
    expect(() => parseSsoProviders(JSON.stringify([{ id: "kc", label: "KC", kind: "oidc", supabaseProvider: "keycloak", exchangeAudience: "x" }]))).toThrow(
      /exchangeAudience applies only to kind "assertion"/,
    )
  })

  it("STOPS the boot when two providers carry one (the exchange reads one provider)", () => {
    const two = [
      { ...base, exchangeAudience: "nodaro-mcp-exchange" },
      { ...base, id: "other", exchangeAudience: "nodaro-mcp-exchange-2" },
    ]
    expect(() => parseSsoProviders(JSON.stringify(two))).toThrow(/only one provider may set "exchangeAudience"/)
  })

  it("is never published", async () => {
    const { ssoPublicInfo } = await import("../sso-providers.js")
    const [p] = parseSsoProviders(JSON.stringify([{ ...base, exchangeAudience: "nodaro-mcp-exchange" }]))
    expect(JSON.stringify(ssoPublicInfo(p))).not.toContain("nodaro-mcp-exchange")
  })
})

describe("verifyAssertion keeps the two uses apart", () => {
  it("the sign-in takes its own audience; the exchange takes its own", async () => {
    await expect(verifyAssertion(provider(), await mint("nodaro-sign-in"), "sign-in")).resolves.toMatchObject({ email: "a@example.com" })
    await expect(verifyAssertion(provider(), await mint("nodaro-mcp-exchange"), "exchange")).resolves.toMatchObject({ email: "a@example.com" })
  })

  it("the sign-in refuses an exchange assertion", async () => {
    await expect(verifyAssertion(provider(), await mint("nodaro-mcp-exchange"), "sign-in")).rejects.toMatchObject({ code: "invalid_claims" })
  })

  it("the exchange refuses a sign-in assertion", async () => {
    await expect(verifyAssertion(provider(), await mint("nodaro-sign-in"), "exchange")).rejects.toMatchObject({ code: "invalid_claims" })
  })

  it("an assertion whose aud names BOTH audiences is refused by both", async () => {
    const both = await mint(["nodaro-sign-in", "nodaro-mcp-exchange"])
    await expect(verifyAssertion(provider(), both, "sign-in")).rejects.toMatchObject({ code: "invalid_claims" })
    await expect(verifyAssertion(provider(), both, "exchange")).rejects.toMatchObject({ code: "invalid_claims" })
    const reversed = await mint(["nodaro-mcp-exchange", "nodaro-sign-in"])
    await expect(verifyAssertion(provider(), reversed, "sign-in")).rejects.toMatchObject({ code: "invalid_claims" })
    await expect(verifyAssertion(provider(), reversed, "exchange")).rejects.toMatchObject({ code: "invalid_claims" })
  })

  it("an array aud naming one use and an unrelated value works for that use only", async () => {
    const token = await mint(["nodaro-mcp-exchange", "something-else"])
    await expect(verifyAssertion(provider(), token, "exchange")).resolves.toBeDefined()
    await expect(verifyAssertion(provider(), token, "sign-in")).rejects.toMatchObject({ code: "invalid_claims" })
  })

  it("a provider without an exchange audience: the sign-in is unchanged (an array aud still passes) and the exchange refuses", async () => {
    const plain = provider({ exchangeAudience: undefined })
    await expect(verifyAssertion(plain, await mint(["nodaro-sign-in", "nodaro-mcp-exchange"]), "sign-in")).resolves.toBeDefined()
    await expect(verifyAssertion(plain, await mint("nodaro-sign-in"))).resolves.toBeDefined()
    await expect(verifyAssertion(plain, await mint("nodaro-sign-in"), "exchange")).rejects.toMatchObject({ code: "invalid_claims" })
  })

  it("the default use is the sign-in", async () => {
    await expect(verifyAssertion(provider(), await mint("nodaro-mcp-exchange"))).rejects.toMatchObject({ code: "invalid_claims" })
  })
})

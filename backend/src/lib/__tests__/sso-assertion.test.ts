import { describe, it, expect } from "vitest"
import { SignJWT } from "jose"
import { verifyAssertion, SsoAssertionError, CLOCK_TOLERANCE_SEC } from "../sso-assertion.js"
import type { SsoProviderConfig } from "../sso-providers.js"

const SECRET = "test-sso-hmac-secret-not-real-000"
const key = new TextEncoder().encode(SECRET)

const provider: SsoProviderConfig = {
  id: "librechat",
  label: "LibreChat",
  kind: "assertion",
  secret: SECRET,
  audience: "nodaro",
  claimMap: { email: "email", emailVerified: "email_verified", subject: "sub" },
  maxLifetimeSeconds: 300,
}

async function mint(
  claims: Record<string, unknown>,
  opts?: { aud?: string; expiresIn?: string; iat?: number; jti?: string | null },
) {
  let b = new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt(opts?.iat)
  b = b.setAudience(opts?.aud ?? "nodaro").setExpirationTime(opts?.expiresIn ?? "2m")
  if (opts?.jti !== null) b = b.setJti(opts?.jti ?? "jti-1")
  return b.sign(key)
}

describe("verifyAssertion", () => {
  it("accepts a valid assertion and extracts claims", async () => {
    const token = await mint({ email: "a@b.com", email_verified: true, sub: "idp-42" })
    const v = await verifyAssertion(provider, token)
    expect(v.email).toBe("a@b.com")
    expect(v.emailVerified).toBe(true)
    expect(v.subject).toBe("idp-42")
    expect(v.jti).toBe("jti-1")
    expect(v.expSeconds).toBeGreaterThan(0)
  })

  it("rejects a wrong signature", async () => {
    const badKey = new TextEncoder().encode("f".repeat(32))
    const token = await new SignJWT({ email: "a@b.com", email_verified: true, sub: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setAudience("nodaro")
      .setExpirationTime("2m")
      .setJti("j")
      .sign(badKey)
    await expect(verifyAssertion(provider, token)).rejects.toMatchObject({ code: "invalid_signature" })
  })

  it("rejects a wrong audience", async () => {
    const token = await mint({ email: "a@b.com", email_verified: true, sub: "x" }, { aud: "someone-else" })
    await expect(verifyAssertion(provider, token)).rejects.toMatchObject({ code: "invalid_claims" })
  })

  it("rejects an expired assertion", async () => {
    const token = await new SignJWT({ email: "a@b.com", email_verified: true, sub: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
      .setAudience("nodaro")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 300)
      .setJti("j")
      .sign(key)
    await expect(verifyAssertion(provider, token)).rejects.toMatchObject({ code: "expired" })
  })

  it("rejects an assertion whose lifetime exceeds the server cap", async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({ email: "a@b.com", email_verified: true, sub: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setAudience("nodaro")
      .setExpirationTime(now + 3600)
      .setJti("j")
      .sign(key) // 1h > 300s cap
    await expect(verifyAssertion(provider, token)).rejects.toMatchObject({ code: "too_long_lived" })
  })

  it("rejects an assertion with no jti (replay-uncacheable)", async () => {
    const token = await mint({ email: "a@b.com", email_verified: true, sub: "x" }, { jti: null })
    await expect(verifyAssertion(provider, token)).rejects.toMatchObject({ code: "missing_jti" })
  })

  it("rejects an assertion with no email claim", async () => {
    const token = await mint({ email_verified: true, sub: "x" })
    await expect(verifyAssertion(provider, token)).rejects.toMatchObject({ code: "missing_email" })
  })

  it("treats a missing email_verified claim as NOT verified", async () => {
    const token = await mint({ email: "a@b.com", sub: "x" })
    const v = await verifyAssertion(provider, token)
    expect(v.emailVerified).toBe(false)
  })

  it("reads claims through a custom claim map", async () => {
    const custom: SsoProviderConfig = {
      ...provider,
      claimMap: { email: "mail", emailVerified: "verified", subject: "uid" },
    }
    const token = await mint({ mail: "z@y.com", verified: true, uid: "u9" })
    const v = await verifyAssertion(custom, token)
    expect(v.email).toBe("z@y.com")
    expect(v.subject).toBe("u9")
  })

  it("throws SsoAssertionError instances (not plain Error)", async () => {
    const token = await mint({ email_verified: true, sub: "x" })
    await expect(verifyAssertion(provider, token)).rejects.toBeInstanceOf(SsoAssertionError)
  })

  // SECURITY: jwtVerify accepts the assertion until `exp + CLOCK_TOLERANCE_SEC`
  // (clock-skew tolerance), so the replay-cache TTL (expSeconds) MUST outlive
  // that whole signature-valid window — otherwise there is a ~tolerance-second
  // gap where the jti key has already expired but the signature still verifies,
  // and a replay slips through. Prove expSeconds ≥ (exp − now) + tolerance.
  it("returns a replay TTL that covers the clock-tolerance window past exp", async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({ email: "a@b.com", email_verified: true, sub: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setAudience("nodaro")
      .setExpirationTime(now + 30)
      .setJti("ttl-jti")
      .sign(key)
    const v = await verifyAssertion(provider, token)
    // 30s remaining + tolerance; allow 2s of slack for execution time.
    expect(v.expSeconds).toBeGreaterThanOrEqual(30 + CLOCK_TOLERANCE_SEC - 2)
  })

  // SECURITY: an assertion that expired within the tolerance window is STILL
  // accepted (skew), and its TTL must therefore stay positive so the jti is
  // cached against replay even in that grace band.
  it("accepts an assertion within the clock-tolerance grace band and keeps a positive TTL", async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({ email: "a@b.com", email_verified: true, sub: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now - 10)
      .setAudience("nodaro")
      .setExpirationTime(now - 2) // 2s past exp, inside the 5s tolerance
      .setJti("grace-jti")
      .sign(key)
    const v = await verifyAssertion(provider, token)
    expect(v.expSeconds).toBeGreaterThanOrEqual(1)
  })

  // SECURITY (SEC-1): the max-lifetime cap must not trust the signer's `iat`.
  // A FUTURE iat makes (exp - iat) look short-lived even when exp is hours away,
  // so a stolen assertion could sit far longer than the cap while slipping past
  // the check. The lifetime is measured against `now` (iat clamped to
  // now + tolerance), so a far-future exp is rejected regardless of iat.
  it("rejects a future-iat assertion whose exp is far beyond the max-lifetime cap", async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({ email: "a@b.com", email_verified: true, sub: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now + 3600) // iat 1h in the FUTURE
      .setAudience("nodaro")
      .setExpirationTime(now + 3700) // exp - iat = 100s (< 300s cap), but exp is ~1h out
      .setJti("future-iat")
      .sign(key)
    await expect(verifyAssertion(provider, token)).rejects.toMatchObject({ code: "too_long_lived" })
  })

  // An honest IdP whose clock runs a few seconds fast (within CLOCK_TOLERANCE_SEC)
  // mints iat slightly ahead of us at exactly the max lifetime — must still pass.
  it("accepts a max-lifetime assertion from an IdP clock within the tolerance band", async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({ email: "a@b.com", email_verified: true, sub: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now + CLOCK_TOLERANCE_SEC) // clock ahead by the tolerance
      .setAudience("nodaro")
      .setExpirationTime(now + CLOCK_TOLERANCE_SEC + 300) // exactly the 300s cap
      .setJti("skewed-iat")
      .sign(key)
    const v = await verifyAssertion(provider, token)
    expect(v.email).toBe("a@b.com")
  })
})

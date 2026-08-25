import { jwtVerify, errors as joseErrors } from "jose"
import type { SsoProviderConfig } from "./sso-providers.js"

export interface VerifiedAssertion {
  email: string
  emailVerified: boolean
  subject: string
  jti: string
  /** Remaining lifetime in seconds, INCLUDING the clock-tolerance grace band
   *  (`exp - now + CLOCK_TOLERANCE_SEC`); the replay-cache TTL floor. Must
   *  cover the entire window in which the signature still verifies. */
  expSeconds: number
}

export type SsoAssertionErrorCode =
  | "invalid_signature"
  | "invalid_claims"
  | "expired"
  | "too_long_lived"
  | "missing_jti"
  | "missing_email"

export class SsoAssertionError extends Error {
  constructor(
    public code: SsoAssertionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "SsoAssertionError"
  }
}

/**
 * Small skew tolerance for clock drift between the IdP and Nodaro. Used BOTH as
 * jose's `clockTolerance` (how far past `exp` a signature still verifies) AND as
 * the padding on the replay TTL — the two MUST agree, or a replayed assertion
 * lands in the gap between "jti key expired" and "signature still valid".
 */
export const CLOCK_TOLERANCE_SEC = 5

/**
 * Verify a bespoke IdP assertion (§5.6). HS256 only, audience-bound, expiry
 * enforced by jose PLUS a server-side max-lifetime cap (a stolen long-lived
 * assertion must not outlive the replay window). Requires jti so the replay
 * cache is real, and email so linking has a subject. Never trusts the IdP to
 * self-limit lifetime.
 */
export async function verifyAssertion(provider: SsoProviderConfig, token: string): Promise<VerifiedAssertion> {
  if (!provider.secret || !provider.audience) {
    // Guaranteed by parseSsoProviders for kind="assertion"; defensive.
    throw new SsoAssertionError("invalid_claims", "provider is not configured for assertion verification")
  }
  const key = new TextEncoder().encode(provider.secret)

  let payload: Record<string, unknown>
  try {
    const result = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      audience: provider.audience,
      clockTolerance: CLOCK_TOLERANCE_SEC,
    })
    payload = result.payload as Record<string, unknown>
  } catch (e) {
    if (e instanceof joseErrors.JWTExpired) throw new SsoAssertionError("expired", "assertion expired")
    if (e instanceof joseErrors.JWTClaimValidationFailed)
      throw new SsoAssertionError("invalid_claims", `assertion claim invalid: ${e.claim}`)
    // JWSSignatureVerificationFailed, JWSInvalid, JWTInvalid, malformed, …
    throw new SsoAssertionError("invalid_signature", "assertion signature or format invalid")
  }

  const jti = typeof payload.jti === "string" ? payload.jti : ""
  if (!jti) throw new SsoAssertionError("missing_jti", "assertion has no jti (replay-uncacheable)")

  const iat = typeof payload.iat === "number" ? payload.iat : undefined
  const exp = typeof payload.exp === "number" ? payload.exp : undefined
  if (exp === undefined) throw new SsoAssertionError("invalid_claims", "assertion has no exp")
  const nowSec = Math.floor(Date.now() / 1000)
  // Measure lifetime against OUR clock, not the signer's `iat`. A FUTURE iat makes
  // (exp - iat) look short-lived while exp is actually far away, slipping past the
  // cap — so clamp iat to now (allowing the same forward-skew band jose already
  // tolerates, so an honest fast IdP clock isn't spuriously rejected). A forged
  // far-future iat can no longer shrink the measured lifetime below the cap.
  const effectiveIat = Math.min(iat ?? nowSec, nowSec + CLOCK_TOLERANCE_SEC)
  const lifetime = exp - effectiveIat
  if (lifetime > provider.maxLifetimeSeconds)
    throw new SsoAssertionError(
      "too_long_lived",
      `assertion lifetime ${lifetime}s exceeds cap ${provider.maxLifetimeSeconds}s`,
    )

  const cm = provider.claimMap
  const emailRaw = payload[cm.email]
  const email = typeof emailRaw === "string" ? emailRaw.trim() : ""
  if (!email) throw new SsoAssertionError("missing_email", `assertion has no "${cm.email}" claim`)

  const verifiedRaw = payload[cm.emailVerified]
  const emailVerified = verifiedRaw === true || verifiedRaw === "true"

  const subjRaw = payload[cm.subject]
  const subject = typeof subjRaw === "string" ? subjRaw : ""

  // The replay TTL must outlive the signature-valid window, which extends to
  // `exp + CLOCK_TOLERANCE_SEC`. Floor at 1s so a just-expired-but-in-grace
  // assertion is still cached against replay.
  const expSeconds = Math.max(exp - nowSec, 1) + CLOCK_TOLERANCE_SEC

  return { email, emailVerified, subject, jti, expSeconds }
}

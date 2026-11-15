import type { SsoProviderConfig } from "./sso-providers.js"
import { verifyAssertion, SsoAssertionError, type AssertionUse, type SsoAssertionErrorCode } from "./sso-assertion.js"
import { claimAssertionJti } from "./sso-replay.js"
import { resolveSsoUser, type SsoLinkResult } from "./sso-linking.js"
import { isUserBlocked } from "./access-blocks.js"

/**
 * THE redemption of a provider's signed assertion (decided 2026-11-11), for
 * both of its uses: the browser sign-in (`routes/sso.ts`, GET /v1/sso/:provider)
 * and the MCP assertion exchange (`routes/oauth-assertion-exchange.ts`,
 * POST /v1/oauth/token with the jwt-bearer grant). Each door decides only how
 * it answers; what an assertion must be and which account it reaches are
 * decided here, once:
 *
 *  1. the verifier (`verifyAssertion`): HS256, the audience of `use` and never
 *     the other use's, expiry, the provider's lifetime cap, a jti;
 *  2. single use (`claimAssertionJti`): ONE store for both uses, keyed by
 *     provider and jti, so a jti is redeemed once whichever door it reaches
 *     first. The audiences already keep a sign-in assertion out of the
 *     exchange and the reverse; a shared store makes "once" hold even for an
 *     issuer that reuses a jti across the two;
 *  3. the account (`resolveSsoUser`): the linking rules, the billing-account
 *     rule (matched by subject on every pass) and the operator-address rule —
 *     including provisioning a person who has no account yet, on a verified
 *     email;
 *  4. a blocked account gets nothing (`lib/access-blocks.ts`).
 *
 * Nothing is caught except the verifier's own refusal: a store or database
 * that cannot be reached throws to the door, which fails closed.
 */

export type RedeemOutcome =
  | { readonly ok: true; readonly userId: string; readonly email: string; readonly action: "linked" | "provisioned" }
  | { readonly ok: false; readonly reason: "assertion"; readonly code: SsoAssertionErrorCode; readonly message: string }
  | { readonly ok: false; readonly reason: "replayed" }
  | { readonly ok: false; readonly reason: "link"; readonly code: Extract<SsoLinkResult, { ok: false }>["code"]; readonly message: string }
  | { readonly ok: false; readonly reason: "blocked" }

export async function redeemAssertion(provider: SsoProviderConfig, assertion: string, use: AssertionUse): Promise<RedeemOutcome> {
  let verified
  try {
    verified = await verifyAssertion(provider, assertion, use)
  } catch (e) {
    if (e instanceof SsoAssertionError) return { ok: false, reason: "assertion", code: e.code, message: e.message }
    throw e
  }

  const fresh = await claimAssertionJti(provider.id, verified.jti, verified.expSeconds)
  if (!fresh) return { ok: false, reason: "replayed" }

  // The account-linking rules — decided before anything is minted.
  const link = await resolveSsoUser(provider, verified)
  if (!link.ok) return { ok: false, reason: "link", code: link.code, message: link.message }
  if (await isUserBlocked(link.userId)) return { ok: false, reason: "blocked" }
  return { ok: true, userId: link.userId, email: link.email, action: link.action }
}

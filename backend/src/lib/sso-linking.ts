import { supabase } from "./supabase.js"
import { ssoLinkExistingEnabled, type SsoProviderConfig } from "./sso-providers.js"
import type { VerifiedAssertion } from "./sso-assertion.js"

export type SsoLinkResult =
  | { ok: true; email: string; userId: string; action: "linked" | "provisioned" }
  | {
      ok: false
      code: "account_exists" | "email_unverified" | "account_linked_other_provider"
      message: string
    }

/**
 * Account-linking rules (§5.6). The one thing this MUST NOT allow: an assertion
 * holder logging into a pre-existing account that merely shares the email
 * (the JIT-by-email takeover the fork was blind to because SSO was its ONLY
 * login). So:
 *   - already SSO-linked to THIS provider ................ link (no re-stamp)
 *   - already SSO-linked to a DIFFERENT provider ........ reject
 *        (account_linked_other_provider) — never re-stamp across IdPs, even with
 *        the link-existing flag on; that flag governs local accounts only.
 *   - existing local account, not federated ............. link ONLY when
 *        EXTERNAL_SSO_LINK_EXISTING=true AND email_verified; else reject
 *   - no account .......................................... provision ONLY when
 *        email_verified (else reject — never let an unverified claim squat a
 *        real address); stamp user_metadata.sso for future logins.
 *
 * user_metadata.sso_subject is persisted best-effort — it is what B3's egress
 * decorator reads to attribute usage to the IdP identity.
 */
export async function resolveSsoUser(
  provider: SsoProviderConfig,
  assertion: VerifiedAssertion,
): Promise<SsoLinkResult> {
  const email = assertion.email.toLowerCase()
  const metadata = { sso: provider.id, sso_subject: assertion.subject }

  // Look up an existing account by email. profiles.email mirrors the auth
  // email (lower-cased). Not addressed by id, so tenant-scope-lint's id-key
  // rule does not apply.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle()

  if (profile?.id) {
    const { data } = await supabase.auth.admin.getUserById(profile.id)
    const existingSso = (data?.user?.user_metadata as Record<string, unknown> | undefined)?.sso
    if (existingSso === provider.id) {
      return { ok: true, email, userId: profile.id, action: "linked" }
    }
    // Already federated to a DIFFERENT IdP — never silently re-stamp to this one.
    // A verified provider-B assertion must not seize a provider-A-linked account
    // that merely shares the email, even with EXTERNAL_SSO_LINK_EXISTING on (that
    // flag adopts UN-federated local accounts only). Distinct code so the caller
    // and the IdP can tell this apart from the plain "email already taken" case.
    if (typeof existingSso === "string" && existingSso.length > 0) {
      return {
        ok: false,
        code: "account_linked_other_provider",
        message: "This email is already linked to a different identity provider.",
      }
    }
    if (ssoLinkExistingEnabled() && assertion.emailVerified) {
      await supabase.auth.admin.updateUserById(profile.id, { user_metadata: metadata })
      return { ok: true, email, userId: profile.id, action: "linked" }
    }
    return {
      ok: false,
      code: "account_exists",
      message: "An account with this email already exists and is not linked to this identity provider.",
    }
  }

  // No account — provision, but only for a verified email.
  if (!assertion.emailVerified) {
    return {
      ok: false,
      code: "email_unverified",
      message: "The identity provider did not assert a verified email; cannot provision an account.",
    }
  }
  const { data: created, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: metadata,
  })
  if (error || !created?.user?.id) {
    // A race (concurrent provision) surfaces here as a create failure; treat as
    // account_exists so the caller returns a clean 403 rather than a 500.
    return {
      ok: false,
      code: "account_exists",
      message: "Could not provision an account for this email.",
    }
  }
  return { ok: true, email, userId: created.user.id, action: "provisioned" }
}

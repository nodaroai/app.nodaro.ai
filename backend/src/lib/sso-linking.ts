import { supabase } from "./supabase.js"
import { ssoLinkExistingEnabled, type SsoProviderConfig } from "./sso-providers.js"
import type { VerifiedAssertion } from "./sso-assertion.js"
// One-way edge, on purpose: this module may ask WHO the deployment payer is,
// and `lib/deployment-payer.ts` must never import back into the SSO graph (its
// header says why — it sits in the import path of every money route). Nothing
// in the payer module's own graph (surface-profile.js → config.js) reaches
// here, so there is no cycle.
import { deploymentPayerId } from "./deployment-payer.js"

/**
 * The SSO marker key. Stamped into BOTH `user_metadata` (back-compat + B3's
 * egress decorator reads `sso_subject` there) AND `app_metadata`. The
 * server-authoritative SSO gate (middleware/auth.ts, SAI-5 / H6) trusts ONLY the
 * `app_metadata` copy: `user_metadata` is settable by a public `supabase.auth.
 * signUp({ options: { data } })`, so a self-registered account could forge the
 * marker there — `app_metadata` is writable only through the service-role admin
 * API this file uses.
 */
export const SSO_APP_METADATA_KEY = "sso"

export type SsoLinkResult =
  | { ok: true; email: string; userId: string; action: "linked" | "provisioned" }
  | {
      ok: false
      code:
        | "account_exists"
        | "email_unverified"
        | "account_linked_other_provider"
        | "account_linked_other_subject"
      message: string
    }

/**
 * ONE message for every "this address already has an account we will not adopt"
 * refusal, and ONE for every unverified-email refusal. Deliberate: `routes/
 * sso.ts` forwards `message` to the browser, so a payer-specific wording would
 * turn the login form into an oracle — present an unverified assertion for a
 * candidate address and the reply tells you whether it is the deployment's
 * billing account. Which account was targeted is a SERVER-side fact
 * (`console.warn` below, the `admin-sso.ts:94` idiom), never a response body.
 */
const ACCOUNT_EXISTS_MESSAGE = "An account with this email already exists and is not linked to this identity provider."
const EMAIL_UNVERIFIED_MESSAGE = "The identity provider did not assert a verified email address."

/**
 * The platform-operator allowlist, read FRESH from the environment — the same
 * source and the same normalisation as `ee/middleware/require-platform-operator
 * .ts:67-76`, deliberately duplicated rather than imported: `lib/` may not
 * import from `ee/` (check-ee-imports), and this module must not gain that
 * module's `supabase`/`config` graph either.
 */
function operatorAllowlist(): Set<string> {
  const raw = process.env.PLATFORM_OPERATOR_EMAILS?.trim()
    ? process.env.PLATFORM_OPERATOR_EMAILS
    : (process.env.PLATFORM_OWNER_EMAIL ?? "")
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

/** One wording for both operator guards; the browser sees only the generic
 *  `account_exists` message, so the refusal is not an oracle either. */
function refusedOperatorAddress(providerId: string): string {
  return (
    `[sso-linking] REFUSED a ${providerId} assertion for a platform-operator address — ` +
    "federating it would close the credit-grant routes to the operator itself"
  )
}

/**
 * Apply any allowance a deployment's billing integration bought for this
 * identity BEFORE the account existed — fire and forget.
 *
 * WHY ON EVERY SUCCESSFUL SIGN-IN, and not only at provisioning. A purchase
 * precedes the first sign-in by construction, but it may also land between an
 * account's creation and its owner's next sign-in, and an apply that failed
 * once (a transient database error on a best-effort call) must heal rather
 * than strand a paid-for quota forever. The database half selects on
 * `applied_at IS NULL`, so the repeat costs one indexed lookup and applies
 * nothing twice.
 *
 * NOTHING HERE MAY DELAY OR FAIL A SIGN-IN. It is not awaited, it swallows
 * everything, and it is called only after the identity is settled — a quota is
 * not a reason for a person to be unable to log in.
 *
 * The import is DYNAMIC for two reasons: `lib/` may not import from `ee/`
 * (`tools/check-ee-imports.mjs`), and this is the shim pattern the repo
 * already uses at that seam (`lib/deployment-payer.ts`, `lib/cancel-job.ts`);
 * and a deployment with no payer must not pull the enterprise billing graph
 * into its sign-in path at all — which the payer check above the import makes
 * true.
 */
function applyPendingAllowanceInBackground(userId: string, subject: string, email: string): void {
  if (deploymentPayerId() === null) return
  void (async () => {
    const { applyPendingAllowance } = await import("../ee/billing/deployment-allowance-service.js")
    await applyPendingAllowance(userId, subject, email)
  })().catch((e: unknown) => {
    console.warn(
      "[sso-linking] a pending allowance could not be applied (the sign-in is unaffected): " +
        (e instanceof Error ? e.message : String(e)),
    )
  })
}

/** The payer's unverified-assertion refusal: generic to the browser, named in
 *  the log. `email_unverified` and never `account_exists` — the payer account
 *  demonstrably exists; what is refused is the CLAIM. */
function payerRefusedUnverified(providerId: string): SsoLinkResult {
  console.warn(
    `[sso-linking] REFUSED a ${providerId} assertion for the deployment's billing account — email not asserted verified`,
  )
  return { ok: false, code: "email_unverified", message: EMAIL_UNVERIFIED_MESSAGE }
}

/**
 * Account-linking rules (§5.6). The one thing this MUST NOT allow: an assertion
 * holder logging into a pre-existing account that merely shares the email
 * (the JIT-by-email takeover the fork was blind to because SSO was its ONLY
 * login). So:
 *   - already SSO-linked to THIS provider ................ link (no re-stamp).
 *        For the PAYER only, that short-circuit is not enough: see "the money
 *        account is not a one-shot" below.
 *   - already SSO-linked to a DIFFERENT provider ........ reject
 *        (account_linked_other_provider) — never re-stamp across IdPs, even with
 *        the link-existing flag on; that flag governs local accounts only.
 *   - the DEPLOYMENT PAYER's own account (D15.2) ........ link when
 *        email_verified, whatever EXTERNAL_SSO_LINK_EXISTING says; an
 *        unverified assertion is rejected `email_unverified`
 *   - existing local account, not federated ............. link ONLY when
 *        EXTERNAL_SSO_LINK_EXISTING=true AND email_verified; else reject
 *   - no account .......................................... provision ONLY when
 *        email_verified (else reject — never let an unverified claim squat a
 *        real address); stamp user_metadata.sso for future logins.
 *
 * D15.2 (supersedes D15.1) — WHY THE PAYER IS EXEMPT FROM THE FLAG. The
 * deployment's billing account holds credits the DEPLOYMENT paid for, and the
 * deployment runs the identity provider: keeping its own provider away from its
 * own pool was never the platform's call to make, and the flag it hung on is an
 * instance-wide switch that cannot be turned on for one account. The platform's
 * money is guarded somewhere else and is UNCHANGED — `requirePlatformOperator`
 * still refuses a federated account on every credit-GRANT route, so nothing the
 * customer's IdP asserts can mint platform credits.
 *
 * The exemption is exactly one uuid wide (`deploymentPayerId()`, resolved at
 * boot from operator-owned surface config, null on mainline) and it relaxes
 * ONLY the flag: an unverified claim still never takes the money account, and a
 * payer already federated to another IdP is still refused above.
 *
 * THE MONEY ACCOUNT IS NOT A ONE-SHOT. "An unverified claim never takes the
 * money account" has to hold on EVERY assertion, not only the one that links.
 * The same-provider short-circuit above answers `linked` on the marker alone,
 * so once the payer is stamped a later assertion carrying its address would
 * sign in with no verified-email claim and from any IdP principal — and
 * `routes/sso.ts` mints the session BY EMAIL, so that session IS the payer's.
 * The payer therefore re-checks on every pass: `email_verified`, plus the
 * assertion's subject against the TRUSTED `app_metadata.sso_subject` (the
 * service-role-only copy; `user_metadata` is rewritable by the account owner).
 * Fail CLOSED when the trusted subject is missing or differs — the break-glass
 * password (B1) is the recovery door, and it is the one door a stale or forged
 * assertion cannot open. Every NON-payer account keeps the cheap short-circuit;
 * widening it to everyone would lock out every user whose IdP stops asserting
 * `email_verified`, which is a separate decision.
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
  const payerId = deploymentPayerId()

  /** The ONE success shape, so that the best-effort pending-allowance apply
   *  cannot be forgotten on a branch: every `ok: true` in this function goes
   *  through here, after the identity is settled and before the return. */
  const signedIn = (userId: string, action: "linked" | "provisioned"): SsoLinkResult => {
    applyPendingAllowanceInBackground(userId, assertion.subject, email)
    return { ok: true, email, userId, action }
  }

  // Look up an existing account by email. profiles.email mirrors the auth
  // email (lower-cased). Not addressed by id, so tenant-scope-lint's id-key
  // rule does not apply.
  //
  // THE ROW IS A HINT, NEVER AN IDENTITY. `profiles.email` is not unique
  // (`099_admin_usage_users_indexes.sql:52` is a plain index), the "Users can
  // update own safe columns" policy does not deny it
  // (`365_signup_signals_free_grant_state.sql:264-278` is a denylist and
  // `email` is not on it), and nothing re-syncs it when an auth email changes
  // (`001_initial_schema.sql:399` only INSERTs). So a duplicate or a stale row
  // must never be allowed to speak for an auth identity: the error is honoured
  // below, and the resolved account's OWN email is cross-checked after it.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle()
  if (profileError) {
    // Includes the multi-row case `maybeSingle()` reports as an error. Fail
    // CLOSED — "we cannot tell which account this address names" is never a
    // licence to provision a second one.
    console.warn(`[sso-linking] account lookup failed for an assertion from ${provider.id}: ${profileError.message}`)
    return { ok: false, code: "account_exists", message: ACCOUNT_EXISTS_MESSAGE }
  }

  if (profile?.id) {
    const { data, error: userError } = await supabase.auth.admin.getUserById(profile.id)
    const user = data?.user
    if (userError || !user) {
      console.warn(`[sso-linking] could not read the account a profile row names (${provider.id} assertion)`)
      return { ok: false, code: "account_exists", message: ACCOUNT_EXISTS_MESSAGE }
    }
    // The cross-check the header's "hint, never an identity" paragraph exists
    // for: the auth record must actually carry the asserted address. Without
    // it, any authenticated user who writes the payer's address into their own
    // `profiles.email` either breaks the payer's sign-in (two rows) or, once
    // the payer's own row is stale, becomes the sole match — and `routes/sso.ts`
    // mints the session by EMAIL, so the session would be the payer's.
    if ((user.email ?? "").toLowerCase() !== email) {
      console.warn(
        `[sso-linking] REFUSED an assertion from ${provider.id}: the profile row matched an account whose auth email differs`,
      )
      return { ok: false, code: "account_exists", message: ACCOUNT_EXISTS_MESSAGE }
    }
    const appMetadata = user.app_metadata as Record<string, unknown> | undefined
    const existingSso = (user.user_metadata as Record<string, unknown> | undefined)?.sso
    const isPayer = profile.id === payerId
    if (existingSso === provider.id) {
      // For the payer the marker alone is NOT a licence — see the header. Both
      // re-checks run on every assertion, not only the linking one.
      if (isPayer) {
        if (!assertion.emailVerified) return payerRefusedUnverified(provider.id)
        const trustedSubject = appMetadata?.sso_subject
        if (typeof trustedSubject !== "string" || trustedSubject !== assertion.subject) {
          console.warn(
            `[sso-linking] REFUSED a ${provider.id} assertion for the deployment's billing account — ` +
              "subject does not match the linked identity (or the trusted copy is absent)",
          )
          return {
            ok: false,
            code: "account_linked_other_subject",
            message: "This account is linked to a different identity at this identity provider.",
          }
        }
      }
      return signedIn(profile.id, "linked")
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
    // From here on the account would be NEWLY federated, and one address must
    // never be: the PLATFORM OPERATOR's. `requirePlatformOperator` refuses a
    // federated account on every credit-GRANT route
    // (require-platform-operator.ts:128-138), so adopting an allowlisted email
    // would not hand the customer's IdP the money routes — it would CLOSE them
    // permanently, for the operator's own password session too, with no product
    // route that strips the marker without also banning the account. That was
    // the real hazard the retired `payerSsoLinkConflict` boot refusal named
    // (its comment said "including the one the platform-operator allowlist
    // names"), and it is the half of it D15.2 does not want back.
    //
    // PLACED HERE, not earlier, on purpose: an operator account that is ALREADY
    // linked to this provider went through the short-circuit above and still
    // signs in. This guard stops the state being CREATED; refusing an account
    // that is already in it would only lock out a session that works today.
    // Inert on mainline (with no payer the operator gate degrades to the
    // ordinary admin check). Env is read FRESH, exactly as
    // require-platform-operator.ts:67-76 does, so `lib/` needs no `ee/` import
    // — and no `hasAdmin` edition gate either, since nothing admin-shaped is
    // imported.
    if (payerId !== null && operatorAllowlist().has(email)) {
      console.warn(refusedOperatorAddress(provider.id))
      return { ok: false, code: "account_exists", message: ACCOUNT_EXISTS_MESSAGE }
    }
    // D15.2 — the billing account links on its first verified sign-in, with no
    // flag. Ordered AFTER the two rules above so neither is weakened for it:
    // a same-provider payer is already "linked", and a payer stamped by a
    // DIFFERENT IdP is still refused rather than re-stamped.
    if (isPayer) {
      if (!assertion.emailVerified) return payerRefusedUnverified(provider.id)
      await supabase.auth.admin.updateUserById(profile.id, {
        user_metadata: metadata,
        app_metadata: metadata,
      })
      return signedIn(profile.id, "linked")
    }
    if (ssoLinkExistingEnabled() && assertion.emailVerified) {
      // Stamp BOTH: user_metadata for egress/back-compat, app_metadata for the
      // server-authoritative auth gate (the only copy that gate trusts).
      await supabase.auth.admin.updateUserById(profile.id, {
        user_metadata: metadata,
        app_metadata: metadata,
      })
      return signedIn(profile.id, "linked")
    }
    return { ok: false, code: "account_exists", message: ACCOUNT_EXISTS_MESSAGE }
  }

  // No account — provision, but only for a verified email.
  if (!assertion.emailVerified) {
    return {
      ok: false,
      code: "email_unverified",
      message: EMAIL_UNVERIFIED_MESSAGE,
    }
  }
  // The same rule on the other path: a JIT-provisioned operator account would
  // be born federated, and therefore born unable to reach the routes the
  // allowlist exists for. See the twin guard above for why.
  if (payerId !== null && operatorAllowlist().has(email)) {
    console.warn(refusedOperatorAddress(provider.id))
    return { ok: false, code: "account_exists", message: ACCOUNT_EXISTS_MESSAGE }
  }
  const { data: created, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: metadata,
    // Service-role-only copy — the SSO gate (middleware/auth.ts) trusts this,
    // NOT user_metadata (which a public signUp can forge).
    app_metadata: metadata,
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
  return signedIn(created.user.id, "provisioned")
}

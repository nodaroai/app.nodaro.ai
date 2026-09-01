/**
 * Deployment payer (SAI item 9) — ONE designated account pays for every
 * action on this instance instead of the requester. The deployment is a
 * reseller: its users never buy Nodaro credits; the instance owner tops up
 * one prepaid account and every reservation debits it, while `jobs.user_id`
 * (ownership, galleries, attribution) stays the human doing the work.
 *
 * Configured by `billing.payerAccount` on the surface profile (a uuid or the
 * account's email — resolved once at boot). ABSENT means INERT: every rule in
 * this file answers "not active" and the payer seam behaves byte-identically
 * to pre-payer mainline — that invariant is what makes this mergeable to a
 * mainline that never configures a payer.
 *
 * FAIL-LOUD at boot (the Phase-B posture): a profile that names a payer
 * account which does not resolve is a misconfigured deployment — every job it
 * accepted would silently bill requesters the owner promised to cover. app.ts
 * turns a failed `configureDeploymentPayer()` into exit(1) on gated editions.
 *
 * ENTITLEMENTS (D2): tier gates under the payer run at the PAYER's grade, but
 * parallelism stays PER-REQUESTER — TIER_PARALLELISM at the payer's tier is
 * stamped into each context, and the orchestrator's per-execution limit keys
 * on it, so one heavy user cannot collapse the whole instance to a single
 * shared budget. The payer's tier is cached with a short TTL and refreshed in
 * the background (the availability-override discipline): a stale grade for
 * ≤60s after an admin changes the payer's tier is acceptable drift.
 *
 * Imports are DEFERRED (dynamic) for the same two reasons as
 * availability-override.ts: `supabase.js` drags `config.js` past vi.mock
 * hoisting in half the backend suite, and `ee/billing/stripe-config.js` may
 * not be imported statically from lib/ (check-ee-imports).
 */
import { runtimeSurfaceProfile } from "./surface-profile.js"
import { hasCredits } from "./config.js"
import type { DeploymentBillingContext, DeploymentEntitlements } from "./billing-context.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Grade to run at when the payer's profile row cannot be read on a refresh —
 *  the SMALLEST paid grade, never free (a deployment payer is never free-tier
 *  work), so a transient DB blip narrows entitlements instead of widening. */
const FALLBACK_TIER = "basic"

const TIER_TTL_MS = 60_000

let payerId: string | null = null
let entitlements: DeploymentEntitlements | null = null
let tierFetchedAt = 0
let refreshInflight: Promise<void> | null = null

async function db() {
  const { supabase } = await import("./supabase.js")
  return supabase
}

async function parallelismForTier(tier: string): Promise<number> {
  const { TIER_PARALLELISM } = await import("../ee/billing/stripe-config.js")
  return TIER_PARALLELISM[tier] ?? TIER_PARALLELISM[FALLBACK_TIER] ?? 4
}

async function readPayerTier(id: string): Promise<string | null> {
  const supabase = await db()
  const { data, error } = await supabase
    .from("profiles")
    .select("tier, subscription_tier, lifetime_topup_credits")
    .eq("id", id)
    .maybeSingle()
  if (error || !data) return null
  const { resolveEffectiveTier } = await import("@nodaro/shared")
  return (
    resolveEffectiveTier({
      tier: (data.tier as string | null) ?? null,
      subscription_tier: (data.subscription_tier as string | null) ?? null,
      lifetime_topup_credits: (data.lifetime_topup_credits as number | null) ?? 0,
    }) ?? FALLBACK_TIER
  )
}

async function refreshEntitlements(id: string): Promise<void> {
  const tier = await readPayerTier(id)
  if (tier === null) {
    console.error("[deployment-payer] payer tier refresh failed — keeping previous grade")
    tierFetchedAt = Date.now() // back off, don't hammer a failing read
    return
  }
  entitlements = {
    watermark: false,
    dailyCapCredits: null,
    parallelism: await parallelismForTier(tier),
    tierForGates: tier,
  }
  tierFetchedAt = Date.now()
}

/**
 * Resolve `billing.payerAccount` (uuid or email) to the payer's user id, or a
 * refusal the boot loader must treat as FATAL. Email resolves through the
 * paged `auth.admin.listUsers` scan (the admin-sso.ts idiom — there is no
 * lookup-by-email admin call in this supabase-js); the page cap stops a
 * misconfig from looping an unbounded directory.
 */
async function resolveAccount(account: string): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const supabase = await db()
  if (UUID_RE.test(account)) {
    const { data, error } = await supabase.from("profiles").select("id").eq("id", account).maybeSingle()
    if (error) return { ok: false, reason: `profile read failed: ${error.message}` }
    if (!data) return { ok: false, reason: `no profile row for uuid ${account}` }
    return { ok: true, id: account }
  }
  const wanted = account.toLowerCase()
  const perPage = 200
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) return { ok: false, reason: `listUsers failed: ${error.message}` }
    const hit = data.users.find((u) => u.email?.toLowerCase() === wanted)
    if (hit) return { ok: true, id: hit.id }
    if (data.users.length < perPage) break
  }
  return { ok: false, reason: `no auth user with email ${account}` }
}

/**
 * Boot entry (app.ts, after the surface fail-closed check). Inert fast-path:
 * no `payerAccount` on the profile ⇒ zero queries, nothing configured.
 * Returns the refusal instead of throwing so the loader owns the exit(1) —
 * the same split as surfaceProfileFailedToLoad.
 */
export async function configureDeploymentPayer(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const account = runtimeSurfaceProfile().billing.payerAccount
  if (!account) return { ok: true }
  if (!hasCredits()) {
    return { ok: false, reason: "billing.payerAccount is set but this edition has no credit system to redirect" }
  }
  const resolved = await resolveAccount(account)
  if (!resolved.ok) return resolved
  payerId = resolved.id
  await refreshEntitlements(payerId)
  if (!entitlements) {
    // The account resolved but its grade did not — do not boot half-configured
    // (a payer whose entitlements never loaded would stamp contexts nothing
    // downstream can type-trust).
    payerId = null
    return { ok: false, reason: `payer account ${resolved.id} resolved but its profile grade could not be read` }
  }
  console.log(`[deployment-payer] active — account ${payerId} pays for this instance (grade: ${entitlements.tierForGates})`)
  return { ok: true }
}

export function deploymentPayerActive(): boolean {
  return payerId !== null
}

/**
 * The one combination that must never boot: a deployment payer (⇒ the CUSTOMER
 * runs the identity provider) together with SSO link-existing (⇒ a verified
 * assertion may adopt a pre-existing local account). Either alone is fine.
 * Together, the customer's IdP can assert a local admin's email and assume
 * that account — including the one the platform-operator allowlist names,
 * which hands back every money route the gate was built to hold.
 *
 * Returns the refusal REASON, or null when the combination is absent. The
 * predicate lives here (testable, no env or process surgery) and app.ts owns
 * the exit(1) — the same split `configureDeploymentPayer` already uses. The
 * flag is passed in rather than read here so this module stays free of the
 * SSO import graph; it is in the import path of every money route.
 */
export function payerSsoLinkConflict(ssoLinkExistingOn: boolean): string | null {
  if (!deploymentPayerActive() || !ssoLinkExistingOn) return null
  return (
    "EXTERNAL_SSO_LINK_EXISTING is on for an instance with a billing.payerAccount. " +
    "The customer's IdP could then assert an existing admin's email and assume that account, " +
    "defeating the platform-operator gate on every money route. Set EXTERNAL_SSO_LINK_EXISTING=false and redeploy."
  )
}

/** The payer's user id (uuid) when active, else null. */
export function deploymentPayerId(): string | null {
  return payerId
}

/**
 * The resolved context for one request. SYNC — the entitlements are the
 * cached grade (boot-guaranteed non-null while active); a stale TTL kicks a
 * background refresh and answers with the current value, so the billing hook
 * costs zero awaited queries per request (its personal-path budget).
 */
export function deploymentBillingContext(requesterId: string): DeploymentBillingContext {
  if (!payerId || !entitlements) {
    throw new Error("[deployment-payer] context requested while inactive — callers must gate on deploymentPayerActive()")
  }
  if (Date.now() - tierFetchedAt > TIER_TTL_MS && !refreshInflight) {
    const id = payerId
    refreshInflight = refreshEntitlements(id)
      .catch((err) => console.error("[deployment-payer] background refresh failed:", (err as Error).message))
      .finally(() => {
        refreshInflight = null
      })
  }
  return { payer: "deployment", userId: requesterId, payerId, entitlements }
}

/** Test hook: reset to the pristine inactive state. */
export function __resetDeploymentPayerForTests(): void {
  payerId = null
  entitlements = null
  tierFetchedAt = 0
  refreshInflight = null
}

/** Test hook: force an active payer without touching the DB. */
export function __setDeploymentPayerForTests(id: string, ent?: Partial<DeploymentEntitlements>): void {
  payerId = id
  entitlements = {
    watermark: false,
    dailyCapCredits: null,
    parallelism: 4,
    tierForGates: "basic",
    ...ent,
  }
  tierFetchedAt = Date.now()
}

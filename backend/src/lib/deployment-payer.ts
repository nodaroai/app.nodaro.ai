/**
 * Deployment payer (item 9) — ONE designated account pays for every
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
 * The SEED for `deployment_payer_settings.default_allowance_credits`, in RAW
 * Nodaro credits, or null when the profile does not carry one.
 *
 * `billing.defaultAllowanceUnits` is a DISPLAY figure (the deployment's unit
 * label); the ledger is credits. `coherentBilling` has already refused any
 * value that is not a whole number of credits at this `unitRate`, so the
 * division is exact and the round only defends against float dust. This is the
 * ONE conversion on this path — never a literal rate anywhere else.
 */
function seedDefaultAllowanceCredits(): number | null {
  const { defaultAllowanceUnits: units, unitRate: rate } = runtimeSurfaceProfile().billing
  if (units === undefined || rate === undefined || !(rate > 0)) return null
  return Math.round(units / rate)
}

/**
 * The profile's default-allowance SEED, in RAW Nodaro credits, or null when the
 * profile carries none.
 *
 * READ THE NAME CAREFULLY: this is the PROFILE's seed, not the deployment's
 * LIVE default. The live figure is `default_allowance_credits` on the
 * `deployment_payer_settings` row, read by `defaultAllowanceCredits()` in
 * `ee/billing/deployment-allowance-service.ts`, and the billing account can
 * change it from its own page. The seed reaches that row on the first insert
 * and, if the row is still UNSET there (0 or NULL — the first boot happened
 * before the profile carried a seed), on a later boot; a POSITIVE stored value
 * is the customer's and no boot ever overwrites it (D6). So on an instance
 * whose default is already set, changing the profile value moves nothing.
 * Every read surface must go through the service;
 * this export exists for `lib/` callers that need the configured seed itself
 * (boot logging, a "what the profile asked for" display) and must never be
 * substituted for the live value.
 */
export function deploymentDefaultAllowanceCredits(): number | null {
  return seedDefaultAllowanceCredits()
}

/**
 * The SSO marker key, written as a LITERAL rather than imported from its home
 * (`lib/sso-linking.ts`, `SSO_APP_METADATA_KEY`). That module statically
 * imports `supabase.js` AND `sso-providers.js` → `config.js`, which is exactly
 * the import-graph pollution this file's header exists to avoid: this module is
 * in the path of every money route and half the backend suite mocks
 * `config.js` partially. The string is the service-role-only `app_metadata` key
 * that `middleware/auth.ts`'s H6 gate already treats as authoritative;
 * `user_metadata` is forgeable by a public signUp and is never consulted.
 */
const SSO_MARKER_KEY = "sso"

/**
 * Is the resolved payer account SSO-FEDERATED? `null` when the answer could not
 * be read — the caller must treat that as a refusal, never as "no".
 *
 * One service-role admin call, on the payer path only (mainline never reaches
 * it — R2). Deliberately uncached and un-retried: it runs once, at boot, and a
 * boot that cannot establish who owns the money account should not come up.
 */
async function payerAccountFederated(id: string): Promise<boolean | null> {
  const supabase = await db()
  try {
    const { data, error } = await supabase.auth.admin.getUserById(id)
    if (error || !data?.user) return null
    return Boolean((data.user.app_metadata as Record<string, unknown> | undefined)?.[SSO_MARKER_KEY])
  } catch {
    return null
  }
}

/**
 * D15.1 — the payer must not be an identity the CUSTOMER's IdP controls.
 *
 * A deployment payer already means the customer runs the identity provider. If
 * the payer account is itself federated, the customer's IdP can re-assert the
 * account that holds Nodaro's credits — and then buy credits on Nodaro's
 * Stripe, mint allowances and read the real balance, all through the third
 * guard that exists to keep exactly that principal out.
 * `requirePlatformOperator` refuses federated accounts on the money routes for
 * this reason (`require-platform-operator.ts:128-140`); the payer identity
 * needs the same rule one layer earlier, at boot, where it can still refuse.
 *
 * A pure predicate over an already-read fact, so it is testable without any
 * process or network surgery — the `payerSsoLinkConflict` shape. It takes the
 * boolean rather than the user object precisely so this module needs no import
 * from the SSO graph.
 *
 * DEVIATION FROM THE PLAN, ON PURPOSE: this one is consulted INSIDE
 * `configureDeploymentPayer`, before the settings write, not beside
 * `payerSsoLinkConflict` in `app.ts` after configure returns. Wiring it after
 * would mean a federated payer's uuid is already installed as
 * `deployment_payer_settings.payer_user_id` — the value migration 381's RLS
 * helper trusts — before the process exits. The refusal must land before
 * anything is written.
 */
export function payerFederatedConflict(federated: boolean): string | null {
  if (!federated) return null
  return (
    "the configured billing.payerAccount is an SSO-FEDERATED account. On a deployment-payer instance the customer " +
    "runs the identity provider, so a federated payer is an account the customer can re-assert at will — handing " +
    "them Nodaro's credit balance, the card on file and every allowance grant. Use a local password account for " +
    "billing.payerAccount (and enrol MFA on it)."
  )
}

/**
 * Write the payer identity into `deployment_payer_settings` (migration 381).
 *
 * WHY THIS IS PART OF BOOT AND NOT A ROUTE: 381's narrowed `profiles` SELECT
 * policy hides the payer's row from admins by asking the database who the payer
 * is, and this is the only writer of that answer. Until it runs, the policy is
 * a no-op and the payer's real balance is readable by every customer-minted
 * admin — which is the leak the migration exists to close. That is why the
 * migration and these lines ship in the same PR (spec §6.1).
 *
 * TWO STATEMENTS, ONE UPSERT. The spec writes it as a single
 * `INSERT … ON CONFLICT (id) DO UPDATE SET payer_user_id = …`; supabase-js
 * cannot express a partial DO UPDATE (it updates every column it is given), so
 * the faithful translation is `DO NOTHING` (`ignoreDuplicates`) followed by an
 * UPDATE that names only the operator-owned columns. Same semantics, and the
 * split makes the load-bearing half legible: the IDENTITY refresh never carries
 * `default_allowance_credits`, because that column is the BILLING ACCOUNT's
 * value after first boot (D6) and an unconditional UPDATE would revert the
 * customer's choice on every deploy.
 *
 * A THIRD, CONDITIONAL STATEMENT seeds that column when the row holds no value
 * anybody chose (0 or NULL) — see the block itself. It is the one case the
 * write-once insert cannot reach, and its cost is a permanent zero.
 *
 * A FAILURE REFUSES BOOT. Returning ok:false here makes app.ts exit(1). The
 * alternative — logging and continuing — leaves `payer_user_id` NULL, and the
 * fail-closed RLS helper then answers NULL and re-opens the leak silently.
 * (Corollary for the deploy: 381 must be applied BEFORE an image carrying this
 * code boots, or the API crash-loops on a missing relation until it is.)
 */
async function writePayerSettings(id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = await db()
  const seed = seedDefaultAllowanceCredits()
  const row: Record<string, unknown> = { id: true, payer_user_id: id }
  if (seed !== null) row.default_allowance_credits = seed

  const inserted = await supabase
    .from("deployment_payer_settings")
    .upsert(row, { onConflict: "id", ignoreDuplicates: true })
  if (inserted.error) {
    return { ok: false, reason: `deployment_payer_settings insert failed: ${inserted.error.message}` }
  }
  const refreshed = await supabase
    .from("deployment_payer_settings")
    .update({ payer_user_id: id, updated_at: new Date().toISOString() })
    .eq("id", true)
  if (refreshed.error) {
    return { ok: false, reason: `deployment_payer_settings refresh failed: ${refreshed.error.message}` }
  }

  // THE SEED BACKFILL — the case the write-once insert cannot reach.
  //
  // "First insert only" is right for a value the billing account owns, and
  // wrong for a row that never got one. The first image carrying 381 can boot
  // on a profile with no `billing.defaultAllowanceUnits` yet; the row lands at
  // the column's `DEFAULT 0`, and adding the key afterwards moves NOTHING,
  // because `ON CONFLICT DO NOTHING` never fires on that row again.
  //
  // A stored 0 is invisible until the flip and total after it: `reserve_credits`
  // lazily provisions each user at `granted_credits = 0`, writes the matching
  // 0-credit 'default' grant, and raises USER_ALLOWANCE_EXCEEDED in the same
  // transaction — a 402 for every un-provisioned user (NOT
  // ALLOWANCE_UNCONFIGURED, which needs a NULL `payer_user_id`). Those rows are
  // then baked: fixing this column later does not touch a user already
  // provisioned at zero, who needs an explicit `grant_deployment_allowance`.
  //
  // So: write the seed whenever the stored value cannot be one the customer
  // chose (0, or NULL defensively — 381 declares the column NOT NULL), and
  // never when it can. A POSITIVE stored value is the billing account's and is
  // left alone whatever the profile now says — the D6 property this backfill
  // must not break. "0 is never a chosen value" is not an assumption: the only
  // setter is `PUT /v1/deployment-billing/default-allowance`, and it refuses
  // zero and negatives outright (`creditsFromUnits`, deployment-billing.ts —
  // "units must be a positive whole number"). If that ever accepts 0, this
  // block starts reverting a real choice and must be reconsidered with it. `seed > 0` is checked first: a seed of 0 asks for nothing
  // and would only ever overwrite something better, and skipping it keeps the
  // extra read off every boot of an instance that carries no seed.
  //
  // NOT a boot refusal, unlike the two statements above it: a missing
  // `payer_user_id` silently re-opens 381's leak, while a seed that did not
  // land is a number the next boot retries and nothing reads until an operator
  // flips enforcement. Taking the API down for it would be the worse failure.
  if (seed !== null && seed > 0) {
    const current = await supabase
      .from("deployment_payer_settings")
      .select("default_allowance_credits")
      .eq("id", true)
      .maybeSingle()
    if (current.error) {
      // Not knowing what the row holds is never licence to overwrite it.
      console.error(
        `[deployment-payer] default_allowance_credits read failed (${current.error.message}) — leaving it untouched`,
      )
      return { ok: true }
    }
    const stored = (current.data as { default_allowance_credits: number | null } | null)?.default_allowance_credits
    const unset = typeof stored !== "number" || !Number.isFinite(stored) || stored <= 0
    if (unset) {
      const backfilled = await supabase
        .from("deployment_payer_settings")
        .update({ default_allowance_credits: seed, updated_at: new Date().toISOString() })
        .eq("id", true)
      if (backfilled.error) {
        console.error(
          `[deployment-payer] default_allowance_credits backfill to ${seed} failed: ${backfilled.error.message}` +
            " — allowances would be provisioned at zero if enforcement is flipped before this succeeds",
        )
        return { ok: true }
      }
      console.log(`[deployment-payer] default_allowance_credits was ${stored ?? "NULL"} — seeded ${seed} from the profile`)
    }
  }
  return { ok: true }
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
  // D15.1, BEFORE the settings write: the settings row is what migration 381's
  // RLS helper trusts, so a federated payer must never get that far. An
  // unreadable account fails CLOSED — "we could not tell who owns the money
  // account" is not a state to boot in.
  const federated = await payerAccountFederated(resolved.id)
  if (federated === null) {
    return {
      ok: false,
      reason: `payer account ${resolved.id} resolved but its identity provider could not be read (fail-closed: refusing to boot rather than assume it is not federated)`,
    }
  }
  const federatedConflict = payerFederatedConflict(federated)
  if (federatedConflict) return { ok: false, reason: federatedConflict }
  // BEFORE activating: a failed write leaves this module in its pristine
  // inactive state, so the refusal needs no unwind branch.
  const settings = await writePayerSettings(resolved.id)
  if (!settings.ok) return settings
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
 * Track A — is per-user allowance ENFORCEMENT on for this deployment?
 *
 * TWO switches, not one (D3). `p_on_behalf_of` (attribution) is passed
 * whenever the billing context is `payer: "deployment"`; this predicate drives
 * `p_enforce_allowance` alone, so rollout step 3 can carry attribution while
 * nothing yet touches the allowance tables — and behaviour case 6 proves that
 * window creates no row and refuses nothing.
 *
 * Both halves are load-bearing. Without an active payer there is no pool to
 * hold a quota against; without `billing.allowances === "enforce"` the
 * deployment has not flipped (the flip is rollout step 8, the ONLY change in
 * the track that can refuse a generation). Absent or malformed ⇒ false, which
 * is the fail-safe direction. `coherentBilling` also drops the key when the
 * display-unit trio is incoherent — a deployment that cannot show an allowance
 * must not enforce one.
 */
export function allowanceEnforcementActive(): boolean {
  return deploymentPayerActive() && runtimeSurfaceProfile().billing.allowances === "enforce"
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

/**
 * D15.3 / B5 — the payg web block and a deployment payer cannot both be on
 * while the payer's own grade is `free` or `payg`.
 *
 * The payg surface block resolves the spendable pool at the PAYER's tier under
 * a payer (`351:363`, `credits.ts:2250`), and `resolveEffectiveTier` turns a
 * free account with any lifetime top-up into `payg` — which is precisely what
 * the billing account's FIRST card purchase does. With
 * `PAYG_WEB_BLOCK_ENABLED` on, every browser-session run on the instance would
 * then raise `SUBSCRIPTION_REQUIRED` against a free pool of zero: the customer
 * paid and nothing runs, for every user at once, with no error that names the
 * cause. Latent today (the flag defaults off) — which is why it is a boot
 * refusal and not a runbook note: the day someone sets the flag must not be
 * the day the instance dies.
 *
 * The flag is PASSED IN, not read here, for the same reason
 * `payerSsoLinkConflict` takes its flag: this module stays out of the
 * `config.js` import graph. `app.ts` passes `config.PAYG_WEB_BLOCK_ENABLED`.
 *
 * Returns null when there is no payer (mainline — R2), when the flag is off,
 * or when the payer is on any paid grade.
 */
export function payerWebFreeConflict(webFreeBlockOn: boolean): string | null {
  if (!deploymentPayerActive() || !webFreeBlockOn || !entitlements) return null
  const tier = entitlements.tierForGates
  if (tier !== "free" && tier !== "payg") return null
  return (
    `PAYG_WEB_BLOCK_ENABLED is on and the deployment payer's effective tier is "${tier}". ` +
    "Under a payer the spend pool is resolved at the PAYER's tier, so every browser-session run on this instance " +
    "would be refused with subscription_required against a free pool — including runs paid for by credits already " +
    "purchased. Put the payer on a paid subscription, or unset PAYG_WEB_BLOCK_ENABLED, and redeploy."
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

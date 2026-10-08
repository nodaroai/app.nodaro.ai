import type { FastifyBaseLogger } from "fastify"
import { supabase } from "../../lib/supabase.js"
import { CreditsService } from "./credits.js"
import { TIER_CREDITS } from "./stripe-config.js"
import { evaluateSignupGrant, type GrantDecision } from "./signup-grant-policy.js"
import { hasGrantedConsent } from "../lib/consent-record.js"
import { isMissingColumnError } from "../../lib/postgrest-errors.js"

/**
 * Free-credit abuse gate: the two state transitions, as service functions.
 *
 * `runSignupGrantClaim` is 'unclaimed' → 'granted' | 'withheld'. It has two
 * callers — the boot-time claim endpoint (arrives with fingerprints) and the
 * server-side fallback on the balance read (arrives with none: a cached
 * pre-gate bundle never calls the endpoint, and without this fallback such a
 * user would sit at zero credits forever). One implementation, so the two
 * can never disagree on what a claim means.
 *
 * `activateSignupGrant` is 'withheld' → 'granted'. Its callers are the card
 * activation endpoint and the admin restore action.
 *
 * Both write the ledger row only when the balance actually moved, and both
 * invalidate the balance cache so the next read shows the credits.
 */

// The state list lives in its own import-free module; re-exported here so
// every existing reader keeps importing it from the grant module.
import { FREE_GRANT_STATES, type FreeGrantState } from "./free-grant-states.js"
export { FREE_GRANT_STATES, type FreeGrantState }

export interface ClaimOutcome {
  state: FreeGrantState
  granted: boolean
  decision: GrantDecision | null
  /** True when the claim stopped at the consent gate: no decision was made,
   *  the account stays 'unclaimed' until marketing-email consent is granted. */
  consentRequired?: boolean
}

/**
 * The welcome-credits opt-in, as seen by one claim. Both fields default to
 * false, which is the pre-426 behaviour: an unconditional claim with the
 * three-argument RPC call. The caller derives them from the request through
 * `welcomeClaimOptions` — never set them by hand at a call site.
 */
export interface ClaimOptions {
  /** Decide only once marketing-email consent is 'granted'; otherwise stay
   *  'unclaimed' and record nothing but a keyed observation. */
  requireConsent?: boolean
  /** Extension exception: grant now and mark `welcome_consent_pending`, so
   *  the web apps block creation until consent is given somewhere. */
  markConsentPending?: boolean
}

/** Shape of one `claim_signup_grant` / `activate_signup_grant` row. */
interface TransitionRow {
  did_claim?: boolean
  did_activate?: boolean
  did_revoke?: boolean
  did_reinstate?: boolean
  old_credits?: number | null
  new_credits?: number | null
  state?: string | null
  refusal?: string | null
}

function firstRow(data: unknown): TransitionRow | null {
  return (Array.isArray(data) ? (data[0] as TransitionRow | undefined) : (data as TransitionRow | null)) ?? null
}

function asState(value: unknown, fallback: FreeGrantState): FreeGrantState {
  return (FREE_GRANT_STATES as readonly unknown[]).includes(value) ? (value as FreeGrantState) : fallback
}

/** Lazy: `routes/credits.ts` pulls in the whole billing surface. */
async function invalidateBalance(userId: string): Promise<void> {
  const { invalidateBalanceCache } = await import("../routes/credits.js")
  invalidateBalanceCache(userId)
}

async function ledgerTopUp(
  userId: string,
  before: number,
  after: number,
  description: string,
): Promise<void> {
  if (after <= before) return
  await CreditsService.logTransaction({
    userId,
    amount: after - before,
    creditType: "subscription",
    source: "signup_grant",
    description,
    balanceAfter: after,
  })
  await invalidateBalance(userId)
}

/**
 * Claim the grant for an 'unclaimed' account. The caller has verified the
 * state; a concurrent claim is resolved by the RPC's own lock.
 *
 * Signal recording is best-effort and the decision fails open, so the only
 * way out of here without a state is an RPC failure — which throws, and the
 * caller answers with a sanitized 500 (the next boot retries).
 */
export async function runSignupGrantClaim(
  params: {
    userId: string
    browserKey: string | null
    deviceKey: string | null
    ipHash: string
    /** 'client' when ipHash is a real client network (only those may become a
     *  network block); omitted/null for an unknown address. */
    ipScheme?: "client" | null
  },
  log: FastifyBaseLogger,
  options: ClaimOptions = {},
): Promise<ClaimOutcome> {
  const { userId, browserKey, deviceKey, ipHash } = params
  const ipScheme = params.ipScheme ?? null

  // Best-effort: a signal we failed to store is a worse observation, not a
  // reason to withhold credits from a legitimate signup.
  //
  // A keyed claim (the browser) may overwrite a keyless row (the fallback)
  // that happened to land first; a keyless claim never overwrites anything.
  // The keys are the observation worth keeping.
  const hasKeys = Boolean(browserKey || deviceKey)
  const recordSignals = async (): Promise<void> => {
    const row = { user_id: userId, browser_key: browserKey, device_key: deviceKey, ip_hash: ipHash, source: "claim" }
    const upsert = (values: Record<string, unknown>) =>
      supabase.from("signup_signals").upsert(values, { onConflict: "user_id,source", ignoreDuplicates: !hasKeys })
    let { error: signalError } = await upsert({ ...row, ip_scheme: ipScheme })
    // Staging runs this before migration 458 adds the column: keep the
    // observation, without the marker, rather than losing the whole row.
    if (signalError && isMissingColumnError(signalError)) ({ error: signalError } = await upsert(row))
    if (signalError) {
      log.warn({ err: signalError, userId }, "signup signal insert failed")
    }
  }

  // Welcome offer: OBSERVE at boot, DECIDE at consent. Without consent the
  // keyed boot claim still leaves its fingerprints (the corpus every later
  // signup is scored against) and stops; the keyless balance-poll fallback
  // writes nothing at all — it runs every 30 s and has nothing to add.
  if (options.requireConsent === true && !(await hasGrantedConsent(userId))) {
    if (hasKeys) {
      await recordSignals()
      // Once per boot claim (the keyless balance poll is silent): the answer
      // to "why is this account still unclaimed" lives in the log.
      log.info({ userId }, "signup grant: waiting for marketing-email consent")
    }
    return { state: "unclaimed", granted: false, decision: null, consentRequired: true }
  }

  await recordSignals()

  const decision = await evaluateSignupGrant({ userId, browserKey, deviceKey, ipHash }, log)

  // The two new arguments travel ONLY when set: with the offer off this is
  // the pre-426 three-argument call, so a dev deploy running ahead of the
  // migration keeps working. The RPC re-checks consent inside the transaction.
  const { data, error: rpcError } = await supabase.rpc("claim_signup_grant", {
    p_user_id: userId,
    p_grant_amount: TIER_CREDITS.free,
    p_withhold: decision.decision === "withheld",
    ...(options.requireConsent === true ? { p_require_consent: true } : {}),
    ...(options.markConsentPending === true ? { p_mark_consent_pending: true } : {}),
  })
  if (rpcError) throw rpcError

  const row = firstRow(data)
  const state = asState(row?.state, "unclaimed")

  // Record what was decided next to the signals it came from. Best-effort;
  // the profile state is the source of truth, this is what admin review reads.
  // Written only when THIS evaluation agrees with the state the row ended in:
  // a caller that lost the race to a differently-decided sibling must not
  // overwrite the winner's reasons with its own.
  if (decision.decision === state) {
    try {
      const { error } = await supabase
        .from("signup_signals")
        .update({ decision: state, reasons: decision.reasons, decided_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("source", "claim")
      if (error) log.warn({ err: error, userId }, "signup grant: decision write failed")
    } catch (err) {
      log.warn({ err, userId }, "signup grant: decision write threw")
    }
  }

  if (state === "withheld") {
    log.info({ userId, reasons: decision.reasons }, "signup grant withheld")
  }

  await ledgerTopUp(userId, Number(row?.old_credits ?? 0), Number(row?.new_credits ?? 0), "Free signup grant")

  return { state, granted: row?.did_claim === true, decision }
}

/** 'withheld' → 'granted'. Returns false when the account was not withheld. */
export async function activateSignupGrant(
  userId: string,
  description: string,
): Promise<{ activated: boolean; state: FreeGrantState }> {
  const { data, error } = await supabase.rpc("activate_signup_grant", {
    p_user_id: userId,
    p_grant_amount: TIER_CREDITS.free,
  })
  if (error) throw error

  const row = firstRow(data)
  await ledgerTopUp(userId, Number(row?.old_credits ?? 0), Number(row?.new_credits ?? 0), description)

  return { activated: row?.did_activate === true, state: asState(row?.state, "withheld") }
}

/**
 * The exit from 'withheld', for the user: a SETTLED purchase.
 *
 * Called by the Stripe webhook after a fresh top-up or auto-recharge grant —
 * and only then: provision-credits.ts gates the call on the idempotent grant
 * RPC's own "granted" answer, so a redelivered or failed grant never re-opens
 * a grant an admin has since taken back. Money moved from a real payment
 * method is the evidence the device and network rules were a proxy for. The
 * previous exit saved a card at $0 and read its fingerprint as "a person we
 * have not seen"; virtual cards made a fresh fingerprint free to mint, so it
 * is gone.
 *
 * Only 'withheld' moves. 'unclaimed' is left to the claim, which reads the
 * purchase itself (`countPurchases`) and grants; 'revoked' is an admin's
 * decision and stays. Never throws: the purchase that triggered it is already
 * granted, and nothing here may fail it — the caller logs the outcome.
 */
export async function activateSignupGrantOnPurchase(
  userId: string,
): Promise<{ activated: boolean; state: FreeGrantState | null }> {
  let state: FreeGrantState | null = null
  try {
    state = await readFreeGrantState(userId)
    if (state !== "withheld") return { activated: false, state }
    const result = await activateSignupGrant(userId, "Free signup grant (activated by first purchase)")
    return { activated: result.activated, state: result.state }
  } catch {
    return { activated: false, state }
  }
}

/** Why a take-back or a restore moved nothing (the RPC's own words, migration 458). */
export type GrantChangeRefusal = "not_found" | "not_revocable" | "not_revoked" | "paid_account" | "reservations_open"

export interface GrantChangeOutcome {
  changed: boolean
  /** The state the account is in afterwards (or was left in), null when it does not exist. */
  state: FreeGrantState | null
  /** Credits the change moved: removed by a take-back, returned by a restore. */
  credits: number
  refusal: GrantChangeRefusal | null
}

function asRefusal(value: unknown): GrantChangeRefusal {
  return value === "not_revocable" || value === "not_revoked" || value === "paid_account" || value === "reservations_open"
    ? value
    : "not_found"
}

/**
 * 'granted' | 'withheld' → 'revoked': an admin takes the free grant back.
 *
 * Removes what is left of the grant (never purchased top-ups) and closes the
 * card-activation path; refused, moving nothing, for a paid or ever-subscribed
 * account and while a reservation is still open (its refund would hand the
 * credits back). The ledger line carries the amount ACTUALLY removed — its
 * description is user-visible (/v1/billing/transactions), so it stays neutral.
 */
export async function revokeSignupGrant(userId: string, adminUserId: string): Promise<GrantChangeOutcome> {
  const { data, error } = await supabase.rpc("revoke_signup_grant", {
    p_user_id: userId,
    p_grant_amount: TIER_CREDITS.free,
    p_admin_id: adminUserId,
  })
  if (error) throw error
  const row = firstRow(data)
  if (row?.did_revoke !== true) {
    return { changed: false, state: row?.state ? asState(row.state, "unclaimed") : null, credits: 0, refusal: asRefusal(row?.refusal) }
  }
  const before = Number(row.old_credits ?? 0)
  const after = Number(row.new_credits ?? 0)
  if (after < before) {
    await CreditsService.logTransaction({
      userId,
      amount: after - before,
      creditType: "subscription",
      source: "admin_adjustment",
      description: "Free credits removed",
      adminUserId,
      balanceAfter: after,
    })
  }
  await invalidateBalance(userId)
  return { changed: true, state: "revoked", credits: before - after, refusal: null }
}

/** 'revoked' → the state it was taken from, with exactly the credits removed. */
export async function reinstateSignupGrant(userId: string, adminUserId: string): Promise<GrantChangeOutcome> {
  const { data, error } = await supabase.rpc("reinstate_signup_grant", { p_user_id: userId })
  if (error) throw error
  const row = firstRow(data)
  if (row?.did_reinstate !== true) {
    return { changed: false, state: row?.state ? asState(row.state, "unclaimed") : null, credits: 0, refusal: asRefusal(row?.refusal) }
  }
  const before = Number(row.old_credits ?? 0)
  const after = Number(row.new_credits ?? 0)
  if (after > before) {
    await CreditsService.logTransaction({
      userId,
      amount: after - before,
      creditType: "subscription",
      source: "admin_adjustment",
      description: "Free credits restored",
      adminUserId,
      balanceAfter: after,
    })
  }
  await invalidateBalance(userId)
  return { changed: true, state: asState(row.state, "granted"), credits: after - before, refusal: null }
}

/** The account's current grant state, or null when the read fails. */
export async function readFreeGrantState(userId: string): Promise<FreeGrantState | null> {
  return (await readFreeGrant(userId))?.state ?? null
}

/**
 * The welcome-offer columns, for the balance payload. Read ONLY while the
 * offer is on (the caller checks) — the columns arrive with migration 426 and
 * a dev deploy may run ahead of it, so a failed read is `null`, never a throw.
 */
export async function readWelcomeOfferState(
  userId: string,
): Promise<{ popupSeen: boolean; consentPending: boolean } | null> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("welcome_offer_seen_at, welcome_consent_pending")
      .eq("id", userId)
      .single()
    if (error || !data) return null
    const row = data as { welcome_offer_seen_at?: unknown; welcome_consent_pending?: unknown }
    return {
      popupSeen: typeof row.welcome_offer_seen_at === "string",
      consentPending: row.welcome_consent_pending === true,
    }
  } catch {
    return null
  }
}

/** State plus the profile's age — the fallback claim needs both. */
export async function readFreeGrant(
  userId: string,
): Promise<{ state: FreeGrantState; createdAt: Date | null } | null> {
  const { data, error } = await supabase.from("profiles").select("free_grant_state, created_at").eq("id", userId).single()
  if (error || !data) return null
  const row = data as { free_grant_state?: unknown; created_at?: unknown }
  const createdAt = typeof row.created_at === "string" ? new Date(row.created_at) : null
  return { state: asState(row.free_grant_state, "unclaimed"), createdAt }
}

/**
 * How long the balance-read fallback leaves a fresh account to the browser.
 * The boot-time claim carries the fingerprints; the fallback carries none.
 * If the fallback claimed first — and the balance read fires before the
 * fingerprint agent finishes — every account would be decided keyless. Two
 * minutes is generous against a 3 s fingerprint deadline, and a stale
 * bundle that never claims is picked up on the next balance poll after it.
 */
export const FALLBACK_CLAIM_GRACE_MS = 2 * 60 * 1000

export function fallbackClaimDue(createdAt: Date | null, now = Date.now()): boolean {
  // Unknown age: assume it is not fresh — the only cost of being wrong here is
  // a keyless decision, and the only cost of never claiming is zero credits.
  if (!createdAt || Number.isNaN(createdAt.getTime())) return true
  return now - createdAt.getTime() >= FALLBACK_CLAIM_GRACE_MS
}


/**
 * Is this balance read coming from a page OTHER than our own SPA?
 *
 * WHY it decides the grace: the keyed claim (POST /v1/credits/claim-signup-grant,
 * the only caller that carries browser/device fingerprints) ships in the
 * app.nodaro.ai SPA bundle alone. Every other browser surface — the thin
 * clients (studio / person / recast / voice), the browser extension — has no
 * claim call, and a cross-origin page could not send the fingerprints anyway.
 * For those, waiting out FALLBACK_CLAIM_GRACE_MS buys nothing: no keyed claim
 * is ever coming, and a user who signs up there and leaves inside two minutes
 * sits at zero credits (incident 2026-09-02, a recast signup gone after 43 s).
 *
 * HOW the SPA is recognized: a same-origin GET carries no Origin header at
 * all, and a same-origin POST carries our own — PUBLIC_URL, the Host header,
 * or the first X-Forwarded-Host hop. The localhost dev origins are the SPA on
 * Vite, which does send the keyed claim. Anything else IS another page.
 *
 * WHAT A FORGED HEADER BUYS, stated plainly: Origin is caller-supplied, so a
 * curl can claim "foreign" and skip the grace. That skips exactly what a
 * caller already skips today by not running the SPA at all — the grace was
 * never a defence against a client that controls its own requests; it exists
 * so the HONEST SPA population's fingerprints land before the keyless
 * fallback decides. An allowlist of published origins would not change that
 * (those names are just as forgeable) and would silently turn the fix off for
 * any surface the operator forgot to list, so there is deliberately none.
 *
 * An opaque ("null"), unparseable or hostless Origin cannot come from a page
 * we can reason about; it keeps today's behaviour (the grace) rather than
 * deciding anything on garbage.
 *
 * Pure on purpose — headers and PUBLIC_URL come in as arguments, so this
 * stays unit-testable next to `fallbackClaimDue`.
 */
export function isForeignOrigin(input: {
  origin: string | undefined
  publicUrl: string
  host: string | undefined
  forwardedHost?: string | undefined
}): boolean {
  const origin = input.origin?.trim()
  // No Origin at all: a same-origin browser GET, or a non-browser client.
  if (!origin) return false

  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (!url.host) return false

  const originHost = url.host.toLowerCase()
  const originHostname = url.hostname.toLowerCase()

  // Dev: the SPA runs on Vite (5173) / the proxy (3000) while the API answers
  // on another port, so it never matches the Host header. It is still the SPA,
  // and it does send the keyed claim — keep the grace.
  if (originHostname === "localhost" || originHostname === "127.0.0.1" || originHostname === "[::1]") return false

  // Our own front door, by any of the three names a request can carry it under.
  const ownHosts: string[] = []
  if (input.publicUrl) {
    try {
      ownHosts.push(new URL(input.publicUrl).host.toLowerCase())
    } catch {
      // An unparseable PUBLIC_URL is a config problem, not an origin verdict.
    }
  }
  if (input.host) ownHosts.push(input.host.trim().toLowerCase())
  // Only the FIRST hop is the host the client actually asked for.
  if (input.forwardedHost) {
    const firstHop = input.forwardedHost.split(",")[0]?.trim().toLowerCase()
    if (firstHop) ownHosts.push(firstHop)
  }
  for (const own of ownHosts) {
    if (!own) continue
    if (own === originHost) return false
    // A Host header may carry a port the origin omits (`app.nodaro.ai:443`).
    // Only when the origin states no explicit port is the bare host equal.
    if (url.port === "" && stripPort(own) === originHostname) return false
  }

  return true
}

/** `example.com:8080` → `example.com`; `[::1]:8080` → `[::1]`. */
function stripPort(hostValue: string): string {
  if (hostValue.startsWith("[")) {
    const end = hostValue.indexOf("]")
    return end === -1 ? hostValue : hostValue.slice(0, end + 1)
  }
  const colon = hostValue.indexOf(":")
  return colon === -1 ? hostValue : hostValue.slice(0, colon)
}

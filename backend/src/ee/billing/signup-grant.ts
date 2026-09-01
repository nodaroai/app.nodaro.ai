import type { FastifyBaseLogger } from "fastify"
import { supabase } from "../../lib/supabase.js"
import { CreditsService } from "./credits.js"
import { TIER_CREDITS } from "./stripe-config.js"
import { evaluateSignupGrant, type GrantDecision } from "./signup-grant-policy.js"

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

export type FreeGrantState = "unclaimed" | "granted" | "withheld"

export interface ClaimOutcome {
  state: FreeGrantState
  granted: boolean
  decision: GrantDecision | null
}

/** Shape of one `claim_signup_grant` / `activate_signup_grant` row. */
interface TransitionRow {
  did_claim?: boolean
  did_activate?: boolean
  old_credits?: number
  new_credits?: number
  state?: string
}

function firstRow(data: unknown): TransitionRow | null {
  return (Array.isArray(data) ? (data[0] as TransitionRow | undefined) : (data as TransitionRow | null)) ?? null
}

function asState(value: unknown, fallback: FreeGrantState): FreeGrantState {
  return value === "granted" || value === "withheld" || value === "unclaimed" ? value : fallback
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
  },
  log: FastifyBaseLogger,
): Promise<ClaimOutcome> {
  const { userId, browserKey, deviceKey, ipHash } = params

  // Best-effort: a signal we failed to store is a worse observation, not a
  // reason to withhold credits from a legitimate signup.
  //
  // A keyed claim (the browser) may overwrite a keyless row (the fallback)
  // that happened to land first; a keyless claim never overwrites anything.
  // The keys are the observation worth keeping.
  const hasKeys = Boolean(browserKey || deviceKey)
  const { error: signalError } = await supabase.from("signup_signals").upsert(
    { user_id: userId, browser_key: browserKey, device_key: deviceKey, ip_hash: ipHash, source: "claim" },
    { onConflict: "user_id,source", ignoreDuplicates: !hasKeys },
  )
  if (signalError) {
    log.warn({ err: signalError, userId }, "signup signal insert failed")
  }

  const decision = await evaluateSignupGrant({ userId, browserKey, deviceKey, ipHash }, log)

  const { data, error: rpcError } = await supabase.rpc("claim_signup_grant", {
    p_user_id: userId,
    p_grant_amount: TIER_CREDITS.free,
    p_withhold: decision.decision === "withheld",
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

/** The account's current grant state, or null when the read fails. */
export async function readFreeGrantState(userId: string): Promise<FreeGrantState | null> {
  return (await readFreeGrant(userId))?.state ?? null
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

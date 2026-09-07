/**
 * Track A — the ONE module that reads the per-user allowance tables from
 * TypeScript.
 *
 * Why one module. Provisioning is lazy (D7): a row appears at the first
 * ENFORCED reserve, so a user who has never generated has no row at all — and
 * every read surface (the credit guard, GET /v1/user/credits, /usage, the
 * admin users list, the billing account's page) must answer
 * `granted = remaining = default_allowance_credits` for them, never 0 and
 * never "unavailable". Zero is a real value that means EXHAUSTED; manufacturing
 * it for "not yet provisioned" refuses a brand-new user's first ever Generate,
 * and the failure is invisible until a real new user arrives. That rule is
 * implemented here, once. `git grep deployment_user_allowances backend/src`
 * must name the table only in this file.
 *
 * Everything answers RAW NODARO CREDITS (see types/deployment-allowance.ts).
 * Conversion to the deployment's display units happens at render, through
 * toUnits, and nowhere else.
 *
 * THE DISPLAY / ENFORCEMENT RULING (orchestrator, 2026-09-04 — it resolves a
 * contradiction WS0, WS4, WS5 and WS7 each flagged independently). The spec
 * asks for two incompatible things: D12 says `allowance` is null while
 * enforcement is off, and §9.1 + §14 step 5 turn the sidebar card on at a
 * rollout step where enforcement is still off — which under D12 would render
 * the frozen signup grant, "a lie" by §9.1's own words. Resolved as TWO
 * SWITCHES, not one:
 *
 *   VISIBLE   whenever `deploymentPayerActive()` — every read here, so the
 *             sidebar, /usage, the admin list and the billing account's page
 *             all tell the truth from rollout step 2 onwards.
 *   ENFORCED  only when `billing.allowances === "enforce"` — a question this
 *             file never asks. The two places that may REFUSE a run consult
 *             `allowanceEnforcementActive()` themselves: the credit guard
 *             (`ee/lib/credit-guard-impl.ts`, before it calls `allowanceFor`
 *             at all) and `reserve_credits` via `p_enforce_allowance`.
 *
 * So a non-null answer from this module never refuses anything. Loosening the
 * gate here is safe precisely because the refusal gate is somewhere else, and
 * that separation is load-bearing: putting enforcement back into these reads
 * would make the pre-flip window lie again.
 *
 * INERT WITHOUT A PAYER (R2): the first line of every entry point is
 * `deploymentPayerActive()`, which is false whenever `billing.payerAccount` is
 * unset — so a mainline deployment issues ZERO queries against tables its
 * database may not even have.
 *
 * AUTHORITY. Nothing here is authoritative. The allowance decision that
 * matters happens inside `reserve_credits`, under `FOR UPDATE` on the allowance
 * row, in the same transaction that debits the payer (D8). These reads are UX:
 * they exist so a user gets a truthful 402 before a job row exists, and so the
 * numbers can be rendered. A read-then-reserve race overshoots by a bounded
 * amount that the RPC, not this file, refuses.
 */
import { supabase } from "../../lib/supabase.js"
import { deploymentPayerActive, deploymentPayerId } from "../../lib/deployment-payer.js"
import type {
  AllowanceApplied,
  AllowanceGrant,
  ResolvedUserRef,
  UserAllowance,
  UserRef,
} from "../../types/deployment-allowance.js"

/** The settings row is read once per TTL: `allowanceFor` consults it on every
 *  no-row user, and the admin list would otherwise read it once per page. The
 *  app-settings / availability-override cadence. */
const DEFAULT_TTL_MS = 60_000
let cachedDefault: number | null = null
let cachedAt = 0

/** Test hook: forget the cached default. */
export function __resetDeploymentAllowanceCacheForTests(): void {
  cachedDefault = null
  cachedAt = 0
}

/**
 * Drop the cached default so the next read sees the settings row again.
 * The write half (`setDefaultAllowance`, WS4) MUST call this: without it the
 * payer changes the default on its own page and the page keeps showing the old
 * figure for up to a minute, which reads as a failed save.
 */
export function invalidateDefaultAllowanceCache(): void {
  __resetDeploymentAllowanceCacheForTests()
}

/**
 * The deployment's default allocation, in RAW credits, or null when there is no
 * payer, no settings row (the migration ran but no boot has written it), or the
 * read failed. Null is "unavailable" — callers must not substitute 0.
 *
 * Gated on `deploymentPayerActive()`, like every read in this file (the
 * ruling): the billing account's page shows and edits the default at rollout
 * step 6, while `allowances` is still "off".
 */
export async function defaultAllowanceCredits(): Promise<number | null> {
  if (!deploymentPayerActive()) return null
  if (cachedDefault !== null && Date.now() - cachedAt < DEFAULT_TTL_MS) return cachedDefault
  const { data, error } = await supabase
    .from("deployment_payer_settings")
    .select("default_allowance_credits")
    .eq("id", true)
    .maybeSingle()
  if (error) {
    console.error("[deployment-allowance] settings read failed:", error.message)
    return null
  }
  const row = data as { default_allowance_credits: number | null } | null
  const credits = row?.default_allowance_credits
  if (typeof credits !== "number" || !Number.isFinite(credits)) return null
  cachedDefault = credits
  cachedAt = Date.now()
  return credits
}

type AllowanceRow = {
  user_id?: string | null
  granted_credits: number | null
  reserved_credits: number | null
  spent_credits: number | null
  /** Written for the first time by `set_deployment_allowance` in `renew` mode
   *  (migration 387). Absent on every row no renewal has touched. */
  reset_at?: string | null
}

const ALLOWANCE_COLUMNS = "user_id, granted_credits, reserved_credits, spent_credits, reset_at"

function fromRow(row: AllowanceRow): UserAllowance {
  const granted = row.granted_credits ?? 0
  const reserved = row.reserved_credits ?? 0
  const spent = row.spent_credits ?? 0
  // GREATEST(…, 0): the D2 clamp lets a metered overrun be absorbed into
  // `spent`, so remaining must floor at 0 rather than render a negative.
  const out: UserAllowance = { granted, remaining: Math.max(granted - reserved - spent, 0), spent }
  // OMITTED, not null, when nothing has ever renewed this allowance: `spent`
  // is then a LIFETIME figure, and the key's absence is exactly what tells a
  // renderer to say "total" rather than "this period". `reset_at` stays
  // column-private to the browser (382 granted four columns and deliberately
  // not this one), so it only ever arrives through the service-role reads
  // here.
  if (row.reset_at) out.resetAt = row.reset_at
  return out
}

/**
 * One user's allowance in raw credits, or null when no allowance applies:
 * no payer, the user IS the payer (D13 — the payer holds the real credits, and
 * answering `remaining: 0` for it would refuse its own runs), or the read was
 * unavailable.
 *
 * NOT gated on enforcement (the ruling at the head of this file). The figure is
 * true from the moment a payer exists, and every surface that renders it may
 * say so; the credit guard checks `allowanceEnforcementActive()` before it ever
 * calls this, so a truthful answer here refuses nobody before the flip.
 *
 * A user with no row gets the default (D7). A user with no row on a deployment
 * whose default cannot be read gets null, not 0.
 */
export async function allowanceFor(userId: string): Promise<UserAllowance | null> {
  if (!deploymentPayerActive()) return null
  if (userId === deploymentPayerId()) return null
  const { data, error } = await supabase
    .from("deployment_user_allowances")
    .select(ALLOWANCE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) {
    console.error("[deployment-allowance] allowance read failed:", error.message)
    return null
  }
  if (!data) {
    const fallback = await defaultAllowanceCredits()
    if (fallback === null) return null
    return { granted: fallback, remaining: fallback, spent: 0 }
  }
  return fromRow(data as AllowanceRow)
}

/**
 * The batch form, for the admin users list and the payer's per-user table: one
 * query for many ids, and the D7 no-row rule applied PER ID — an id Postgres
 * returned no row for is a user who has not generated yet, and gets the
 * default.
 *
 * Returns null when the whole batch is unavailable (no payer, a read error, or
 * an unreadable default), mirroring the `report()` posture in
 * nodaro-cloud-provider.ts. Null rather than a PARTIAL map, because a map that
 * silently omits the no-row users renders them as `—` on the admin list — D7's
 * rule broken in the one place nobody would look. The payer's own id is never
 * queried and never appears in the map.
 */
export async function allowancesFor(userIds: string[]): Promise<Map<string, UserAllowance> | null> {
  if (!deploymentPayerActive()) return null
  const payerId = deploymentPayerId()
  const ids = [...new Set(userIds)].filter((id) => id !== payerId)
  const out = new Map<string, UserAllowance>()
  if (ids.length === 0) return out
  const { data, error } = await supabase.from("deployment_user_allowances").select(ALLOWANCE_COLUMNS).in("user_id", ids)
  if (error) {
    console.error("[deployment-allowance] batch allowance read failed:", error.message)
    return null
  }
  for (const row of (data ?? []) as AllowanceRow[]) {
    if (typeof row.user_id === "string") out.set(row.user_id, fromRow(row))
  }
  const missing = ids.filter((id) => !out.has(id))
  if (missing.length > 0) {
    const fallback = await defaultAllowanceCredits()
    if (fallback === null) return null
    for (const id of missing) out.set(id, { granted: fallback, remaining: fallback, spent: 0 })
  }
  return out
}

// ===========================================================================
// The WRITE half (WS4), and the billing account's own read
// ===========================================================================
//
// ONE gate, everywhere in this file: `deploymentPayerActive()`. Under the
// ruling at the head of the file the reads above answer "what does this user
// have?" — a question with a true answer from rollout step 2 — and the reads
// below answer the billing account's "what have I allocated, and to whom?".
// Neither is the enforcement question, which no function here asks.
//
// What distinguishes the two halves is DETAIL, not authority. `UserAllowance`
// is the figure every surface renders; `AllowanceLedgerRow` adds `provisioned`,
// which only the payer's page has a use for (it separates "has generated" from
// "will get the default at their first Generate" without giving 0 a second
// meaning), and `grantsFor` adds the audit trail behind it.

/** One row of the billing account's per-user table, in RAW credits: the three
 *  figures every surface renders, plus the one only this page has a use for.
 *
 *  `provisioned` says whether a row exists at all, so the page can distinguish
 *  "has generated" from "will get the default at their first Generate" without
 *  inventing a second meaning for 0. That single extra field is the whole
 *  reason these two reads are not `allowanceFor`/`allowancesFor` — the three
 *  figures come from the same `fromRow`, so the arithmetic cannot drift. */
export interface AllowanceLedgerRow extends UserAllowance {
  provisioned: boolean
}

function ledgerFromRow(row: AllowanceRow): AllowanceLedgerRow {
  return { ...fromRow(row), provisioned: true }
}

/** The D7 no-row answer, in ledger shape. */
function ledgerDefault(fallback: number): AllowanceLedgerRow {
  return { granted: fallback, remaining: fallback, spent: 0, provisioned: false }
}

/**
 * The billing account's per-user table: one query for the whole page, the D7
 * no-row rule applied PER ID. Null when there is no payer or the read (or the
 * default behind it) was unavailable — never a partial map, for the same
 * reason `allowancesFor` refuses one.
 *
 * The payer's own id is filtered out: it holds the pool, not an allowance
 * (D13), and a row for it on this page would read as an allocation to itself.
 */
export async function allowanceLedgerFor(userIds: string[]): Promise<Map<string, AllowanceLedgerRow> | null> {
  if (!deploymentPayerActive()) return null
  const payerId = deploymentPayerId()
  const ids = [...new Set(userIds)].filter((id) => id !== payerId)
  const out = new Map<string, AllowanceLedgerRow>()
  if (ids.length === 0) return out
  const { data, error } = await supabase.from("deployment_user_allowances").select(ALLOWANCE_COLUMNS).in("user_id", ids)
  if (error) {
    console.error("[deployment-allowance] ledger batch read failed:", error.message)
    return null
  }
  for (const row of (data ?? []) as AllowanceRow[]) {
    if (typeof row.user_id === "string") out.set(row.user_id, ledgerFromRow(row))
  }
  const missing = ids.filter((id) => !out.has(id))
  if (missing.length > 0) {
    const fallback = await defaultAllowanceCredits()
    if (fallback === null) return null
    for (const id of missing) out.set(id, ledgerDefault(fallback))
  }
  return out
}

/** One user's ledger row for the billing account — the same rule, one id.
 *  Used after a grant, so the page renders what the database now holds rather
 *  than what the client hoped the arithmetic would be. */
export async function allowanceLedgerOne(userId: string): Promise<AllowanceLedgerRow | null> {
  if (!deploymentPayerActive()) return null
  if (userId === deploymentPayerId()) return null
  const { data, error } = await supabase
    .from("deployment_user_allowances")
    .select(ALLOWANCE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) {
    console.error("[deployment-allowance] ledger read failed:", error.message)
    return null
  }
  if (!data) {
    const fallback = await defaultAllowanceCredits()
    return fallback === null ? null : ledgerDefault(fallback)
  }
  return ledgerFromRow(data as AllowanceRow)
}

/**
 * One user's grant history, newest first, in RAW credits.
 *
 * `overrun` rows are INCLUDED and carry their `kind`, because they are part of
 * the audit trail the payer is looking at — but they are audit-only and are
 * excluded from `granted_credits` (invariant 4), so whatever renders this must
 * label them or the column will not add up to `granted`.
 */
export async function grantsFor(
  userId: string,
  opts: { limit: number; offset: number },
): Promise<AllowanceGrant[] | null> {
  if (!deploymentPayerActive()) return null
  const { data, error } = await supabase
    .from("deployment_allowance_grants")
    .select("id, credits, kind, note, created_at, credential_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1)
  if (error) {
    console.error("[deployment-allowance] grant history read failed:", error.message)
    return null
  }
  return ((data ?? []) as ReadonlyArray<{
    id: string
    credits: number | null
    kind: string
    note: string | null
    created_at: string
    credential_id?: string | null
  }>).map((r) => ({
    id: r.id,
    credits: r.credits ?? 0,
    kind: r.kind as AllowanceGrant["kind"],
    createdAt: r.created_at,
    note: r.note,
    // NULL = the billing account's own browser session. The page renders
    // "via <key>" only when this names a key that still exists — the FK is
    // ON DELETE SET NULL, so a revoked key's history degrades to "the page"
    // rather than disappearing.
    credentialId: r.credential_id ?? null,
  }))
}

/**
 * Why a write was refused. Each maps 1:1 onto an exception prefix
 * `grant_deployment_allowance` raises (WS1's migration 382), so the HTTP
 * status is decided in one place and a new database refusal cannot silently
 * become a 500 that reads as "we broke".
 */
export type AllowanceWriteErrorCode =
  | "allowance_unconfigured"
  | "allowance_actor_not_payer"
  | "allowance_kind_invalid"
  | "allowance_zero_grant"
  | "allowance_below_committed"
  // 387's two verbs add two refusals: a mode that is neither `set` nor
  // `renew`, and a target that is NULL or negative. ZERO is not among them —
  // a cancelled plan is a quota of 0, and only a MOVE of zero (the additive
  // grant) is a caller bug.
  | "allowance_mode_invalid"
  | "allowance_target_invalid"
  | "allowance_write_failed"

export type AllowanceWriteResult = { ok: true } | { ok: false; code: AllowanceWriteErrorCode; message: string }

/** The RPC's exception prefixes, in the order the function checks them.
 *  Prefix match, never substring: the raised text carries interpolated
 *  figures after the colon and must not be echoed to a browser. */
const GRANT_PREFIXES: ReadonlyArray<[string, AllowanceWriteErrorCode]> = [
  ["ALLOWANCE_UNCONFIGURED:", "allowance_unconfigured"],
  ["ALLOWANCE_ACTOR_NOT_PAYER:", "allowance_actor_not_payer"],
  ["ALLOWANCE_KIND_INVALID:", "allowance_kind_invalid"],
  ["ALLOWANCE_ZERO_GRANT:", "allowance_zero_grant"],
  ["ALLOWANCE_BELOW_COMMITTED:", "allowance_below_committed"],
  ["ALLOWANCE_MODE_INVALID:", "allowance_mode_invalid"],
  ["ALLOWANCE_TARGET_INVALID:", "allowance_target_invalid"],
]

/** What `find_user_by_sso_subject` raises when a subject matches more than one
 *  account (migration 387). The function used to answer NULL for that, which
 *  is the same answer it gives for "no account" — and the route acts on the
 *  two very differently. */
const SSO_SUBJECT_AMBIGUOUS_PREFIX = "SSO_SUBJECT_AMBIGUOUS:"

function classifyGrantError(raw: string): { code: AllowanceWriteErrorCode; message: string } {
  for (const [prefix, code] of GRANT_PREFIXES) {
    if (raw.startsWith(prefix)) return { code, message: raw }
  }
  return { code: "allowance_write_failed", message: raw }
}

/**
 * Move a user's `granted_credits`, through the RPC that is its only writer.
 *
 * All SIX parameters are supplied every time: `grant_deployment_allowance`
 * declares NO defaults, so an omitted one is a different arity and PostgREST
 * answers "function not found" — which would surface as a 500 on a top-up that
 * simply had no note. (It took five until migration 387 added the credential
 * line, and 387 DROPS the five-argument signature — which is why an image
 * rolled back below 387 cannot call this function at all. 387's header says
 * what a rollback has to re-apply.)
 *
 * `actorId` must be the payer's own id. The route guard already established
 * that, and the RPC asserts it again against `deployment_payer_settings` — a
 * database-level restatement of decision (3) that does not depend on this
 * file, or the guard, being correct.
 *
 * `credits` is RAW. Negative is legal only as a `correction`, and the RPC
 * REFUSES (never clamps) one that would push `granted` below
 * `reserved + spent`: clamping would invalidate a running job.
 */
export async function grantAllowance(params: {
  userId: string
  credits: number
  actorId: string
  kind: "topup" | "correction"
  note: string | null
  /** Which credential moved the quota — null (or omitted) for the billing
   *  account's own browser session. Optional HERE and required by the RPC:
   *  the page has no credential to name, and 387 gave the argument no default
   *  precisely so that this module, its one caller, states it every time. */
  credentialId?: string | null
}): Promise<AllowanceWriteResult> {
  const { error } = await supabase.rpc("grant_deployment_allowance", {
    p_user_id: params.userId,
    p_credits: params.credits,
    p_actor_id: params.actorId,
    p_kind: params.kind,
    p_note: params.note,
    p_credential_id: params.credentialId ?? null,
  })
  if (error) {
    const classified = classifyGrantError(error.message ?? "")
    console.error(`[deployment-allowance] grant refused (${classified.code}):`, classified.message)
    return { ok: false, ...classified }
  }
  return { ok: true }
}

/**
 * Set the deployment's default allocation, in RAW credits.
 *
 * There is no RPC for this one: the settings row is a singleton the boot
 * upsert already created, and a service-role UPDATE is the whole operation. So
 * the actor check that `grant_deployment_allowance` makes in SQL is made here
 * instead — belt for the route guard's braces, and the reason this function
 * takes an `actorId` it could otherwise infer.
 *
 * D7: this changes the default for users who have NOT generated yet. It does
 * not retro-apply, and it does not move a single existing row — whatever
 * renders it must say so.
 */
export async function setDefaultAllowance(credits: number, actorId: string): Promise<AllowanceWriteResult> {
  const payerId = deploymentPayerId()
  if (!payerId) {
    return { ok: false, code: "allowance_unconfigured", message: "no deployment payer is configured" }
  }
  if (actorId !== payerId) {
    return { ok: false, code: "allowance_actor_not_payer", message: "actor is not the billing account" }
  }
  const { data, error } = await supabase
    .from("deployment_payer_settings")
    .update({ default_allowance_credits: credits, updated_by: actorId, updated_at: new Date().toISOString() })
    .eq("id", true)
    .select("id")
  if (error) {
    console.error("[deployment-allowance] default write failed:", error.message)
    return { ok: false, code: "allowance_write_failed", message: error.message }
  }
  // An UPDATE that matches nothing is not an error to PostgREST — it is a
  // success that changed no row. Here it means the singleton the boot upsert
  // is supposed to have written does not exist, and reporting 200 would tell
  // the payer their new default was saved when it went nowhere.
  if (Array.isArray(data) && data.length === 0) {
    return {
      ok: false,
      code: "allowance_unconfigured",
      message: "deployment_payer_settings has no row — the boot upsert has not run against this database",
    }
  }
  // MANDATORY, not an optimisation: the read side caches the default for a
  // minute, so without this the payer saves a new figure and the page keeps
  // showing the old one — which reads as a save that silently failed.
  invalidateDefaultAllowanceCache()
  return { ok: true }
}

/**
 * The pool balance, in RAW credits, below which the deployment calls itself
 * low — or null when the payer has not set one.
 *
 * A FAILED READ ANSWERS NULL, like "not set". A threshold is a convenience on
 * top of a balance, and losing it must not take the balance down with it; null
 * is also the honest answer for a database that has not reached the migration
 * yet. The judgement itself (`balance < threshold`) belongs to the caller,
 * which is the only place that knows whether the balance is even readable.
 *
 * Here rather than in the route because `deployment_payer_settings` is named
 * in this file and in the boot upsert, and nowhere else — the same rule that
 * keeps the allowance table in one place.
 */
export async function readLowBalanceThreshold(payerId: string): Promise<number | null> {
  if (!payerId) return null
  const { data, error } = await supabase
    .from("deployment_payer_settings")
    .select("low_balance_threshold_credits")
    .eq("id", true)
    .maybeSingle()
  if (error) {
    console.error("[deployment-allowance] low-balance threshold read failed:", error.message)
    return null
  }
  const raw = (data as { low_balance_threshold_credits?: number | null } | null)?.low_balance_threshold_credits
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null
}

/**
 * Set — or CLEAR — that threshold. `null` clears it; `0` is a real threshold
 * meaning "tell me when the pool is empty", and the two must never be
 * collapsed: sending 0 for a clear arms an alert the payer just turned off.
 *
 * The same shape as `setDefaultAllowance` above, and for the same reasons:
 * there is no RPC behind this column, so the actor assertion the database
 * would have made is made here, and an UPDATE that matched no row is reported
 * rather than answered as a save.
 */
export async function setLowBalanceThreshold(
  credits: number | null,
  actorId: string,
): Promise<AllowanceWriteResult> {
  const payerId = deploymentPayerId()
  if (!payerId) {
    return { ok: false, code: "allowance_unconfigured", message: "no deployment payer is configured" }
  }
  if (actorId !== payerId) {
    return { ok: false, code: "allowance_actor_not_payer", message: "actor is not the billing account" }
  }
  const { data, error } = await supabase
    .from("deployment_payer_settings")
    .update({
      low_balance_threshold_credits: credits,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true)
    .select("id")
  if (error) {
    console.error("[deployment-allowance] threshold write failed:", error.message)
    return { ok: false, code: "allowance_write_failed", message: error.message }
  }
  if (Array.isArray(data) && data.length === 0) {
    return {
      ok: false,
      code: "allowance_unconfigured",
      message: "deployment_payer_settings has no row — the boot upsert has not run against this database",
    }
  }
  return { ok: true }
}

/**
 * How many users have an allowance ROW — i.e. have generated at least once
 * under enforcement. The complement of the deployment's user count is the set
 * that will be provisioned at the default on their first Generate (D7), which
 * is what the billing account is actually looking at when it decides a default.
 *
 * It lives here rather than in the route for the reason the whole module
 * exists: `deployment_user_allowances` is named in exactly one file, so no
 * second place can grow a subtly different idea of what a row means.
 */
export async function provisionedUserCount(): Promise<number | null> {
  if (!deploymentPayerActive()) return null
  const { count, error } = await supabase
    .from("deployment_user_allowances")
    .select("user_id", { count: "exact", head: true })
  if (error) {
    console.error("[deployment-allowance] provisioned count failed:", error.message)
    return null
  }
  return count ?? null
}

// ===========================================================================
// The INTEGRATION half (migration 387): set, renew, pending, and the two
// identity lookups an integration names a person with.
// ===========================================================================
//
// Everything below is still RAW NODARO CREDITS (R3): `creditsFromUnits` on the
// way in at the route, `toUnits` at render, and nothing in between multiplies.
// A display unit that reached `set_deployment_allowance` would make every
// stored allowance wrong the day the rate moved — and unlike a rendered
// figure, a stored one is wrong forever.
//
// The table names stay in this file. `deployment_allowance_pending` joins
// `deployment_user_allowances` and `deployment_allowance_grants` under that
// rule: one module knows the relations, so no second place can grow a
// different idea of what a row means.

/** What `setAllowance` did, plus what the database now holds. `applied:
 *  "noop"` is a SUCCESS — the target was already the granted figure, which is
 *  the correct answer to a replayed call. */
export type AllowanceSetResult =
  | { ok: true; applied: AllowanceApplied; row: UserAllowance }
  | { ok: false; code: AllowanceWriteErrorCode; message: string }

/**
 * Set a user's allowance to an ABSOLUTE target, through the RPC that computes
 * the delta server-side.
 *
 * Why absolute rather than additive: an integration knows "this customer's
 * plan is 50 000", not the delta from a figure it never read — and a delta
 * computed on the caller's side turns a retry after a timeout into a second
 * allocation. `set` is idempotent by construction; `renew` additionally zeroes
 * `spent` and stamps the period.
 *
 * `targetCredits` may be ZERO (a cancelled plan is a quota of 0) but never
 * negative. Both refusals, and the "below what is already committed" refusal,
 * come back through the same prefix classifier as a grant's, so a new database
 * refusal cannot silently become a 500.
 *
 * NOT gated on `deploymentPayerActive()` — deliberately, unlike every READ in
 * this file. The RPC asserts the actor against `deployment_payer_settings`
 * itself, which is the check that actually holds, and a local gate here would
 * add a second answer to "is there a payer?" that could disagree with the
 * database's. Every caller is a route that is only registered when a payer
 * exists.
 */
export async function setAllowance(params: {
  userId: string
  targetCredits: number
  actorId: string
  mode: "set" | "renew"
  note: string | null
  credentialId?: string | null
}): Promise<AllowanceSetResult> {
  const { data, error } = await supabase.rpc("set_deployment_allowance", {
    p_user_id: params.userId,
    p_target_credits: params.targetCredits,
    p_actor_id: params.actorId,
    p_mode: params.mode,
    p_note: params.note,
    p_credential_id: params.credentialId ?? null,
  })
  if (error) {
    const classified = classifyGrantError(error.message ?? "")
    console.error(`[deployment-allowance] ${params.mode} refused (${classified.code}):`, classified.message)
    return { ok: false, ...classified }
  }
  // The RPC RETURNS TABLE, so PostgREST answers an ARRAY of one row. A missing
  // row is not "nothing changed" — it is a function that did not behave as
  // declared, and reporting success would tell the caller a quota moved when
  // nothing is known to have.
  const row = (Array.isArray(data) ? data[0] : data) as
    | (AllowanceRow & { applied?: string })
    | undefined
    | null
  if (!row || typeof row.applied !== "string") {
    return {
      ok: false,
      code: "allowance_write_failed",
      message: "set_deployment_allowance returned no row",
    }
  }
  return { ok: true, applied: row.applied as AllowanceApplied, row: fromRow(row) }
}

/** 90 days: long enough that a plan bought before a slow onboarding still
 *  lands, short enough that one bought for somebody who never arrives does not
 *  wait forever to be applied to whoever eventually claims that address. */
const PENDING_TTL_DAYS = 90

export type PendingWriteResult =
  | { ok: true; id: string; expiresAt: string }
  | { ok: false; code: AllowanceWriteErrorCode; message: string }

/**
 * Store an allowance for someone who has no studio account yet, keyed by the
 * identity their IdP will assert.
 *
 * A purchase precedes the first sign-in by construction: the back office knows
 * an email and a subject, and there is no studio uuid to name. The alternative
 * — refusing and asking the integration to retry after the first login — puts
 * ledger state into the back office and loses it when the retry never comes.
 *
 * A REPLAY REPLACES rather than queues: the unapplied row for that identity is
 * deleted first, so "the plan is now 50 000, no, 60 000" leaves one intent and
 * not two. (The partial unique indexes make the alternative a constraint
 * violation rather than a silent double-apply, so this is the only shape that
 * both replays cleanly and cannot double-allocate.)
 *
 * The email is stored LOWER-CASED, which is what makes the delete above an
 * `eq` and matches the `lower(email)` index the apply RPC selects on.
 */
export async function writePendingAllowance(params: {
  ssoSubject?: string | null
  email?: string | null
  targetCredits: number
  mode: "set" | "renew"
  note: string | null
  createdBy: string
  credentialId?: string | null
  ttlDays?: number
}): Promise<PendingWriteResult> {
  const subject = params.ssoSubject?.trim() || null
  const email = params.email?.trim().toLowerCase() || null
  if (!subject && !email) {
    return {
      ok: false,
      code: "allowance_write_failed",
      message: "a pending allowance must name an SSO subject or an email address",
    }
  }
  if (!Number.isInteger(params.targetCredits) || params.targetCredits < 0) {
    // The same rule the RPC enforces, restated before a row is written: a
    // stored intent that the apply would later refuse is a quota that silently
    // never lands.
    return {
      ok: false,
      code: "allowance_target_invalid",
      message: "a pending allowance target must be zero or a positive whole number of credits",
    }
  }
  // `created_by` is documented as "always the payer, asserted at write" — this
  // is that assertion. The two RPCs make the same one in SQL against the
  // settings singleton; a pending row has no RPC behind it, so without this
  // the column's claim would be a comment rather than a rule.
  const payerId = deploymentPayerId()
  if (!payerId) {
    return { ok: false, code: "allowance_unconfigured", message: "no deployment payer is configured" }
  }
  if (params.createdBy !== payerId) {
    return { ok: false, code: "allowance_actor_not_payer", message: "actor is not the billing account" }
  }
  const expiresAt = new Date(Date.now() + (params.ttlDays ?? PENDING_TTL_DAYS) * 86_400_000).toISOString()

  // CLEAR BOTH KEYS, not the "best" one. The unique indexes are partial and
  // there are TWO of them — `(sso_subject)` and `(lower(email))`, each WHERE
  // `applied_at IS NULL` — so clearing only by subject leaves an EARLIER
  // email-only intent for the same person standing, and the insert below then
  // violates the email index and answers 500 to an integrator that did nothing
  // wrong. "A replay replaces" has to mean every row this one would collide
  // with, and the two deletes are the only shape that says that.
  for (const [column, value] of [
    ["sso_subject", subject],
    ["email", email],
  ] as const) {
    if (!value) continue
    const { error: clearError } = await supabase
      .from("deployment_allowance_pending")
      .delete()
      .is("applied_at", null)
      .eq(column, value)
    if (clearError) {
      console.error("[deployment-allowance] pending replace failed:", clearError.message)
      return { ok: false, code: "allowance_write_failed", message: clearError.message }
    }
  }

  const { data, error } = await supabase
    .from("deployment_allowance_pending")
    .insert({
      sso_subject: subject,
      email,
      target_credits: params.targetCredits,
      mode: params.mode,
      note: params.note,
      created_by: params.createdBy,
      credential_id: params.credentialId ?? null,
      expires_at: expiresAt,
    })
    .select("id, expires_at")
    .maybeSingle()
  if (error || !data) {
    const message = error?.message ?? "the pending allowance was not written"
    console.error("[deployment-allowance] pending write failed:", message)
    return { ok: false, code: "allowance_write_failed", message }
  }
  const row = data as { id: string; expires_at: string }
  return { ok: true, id: row.id, expiresAt: row.expires_at }
}

/**
 * Apply every unapplied, unexpired intent for this identity. Returns how many
 * were applied — and NEVER THROWS.
 *
 * Called from the SSO path on EVERY successful sign-in, for both a newly
 * provisioned account and an existing one being linked: an intent written
 * between an account's creation and its owner's next sign-in would otherwise
 * never apply, and an apply that failed once heals on the following sign-in
 * instead of stranding a paid-for quota.
 *
 * BEST EFFORT IS THE WHOLE CONTRACT. A sign-in must never fail, and must never
 * wait, because of a quota that can be applied a minute later — so every
 * failure path here is a log line and a 0. The database half is idempotent
 * (`applied_at IS NULL` is both the selection and the effect), so a repeat is
 * free.
 *
 * Inert without a payer: no payer means no settings row, which the RPC answers
 * with `ALLOWANCE_UNCONFIGURED` — but the gate is checked here first so a
 * mainline deployment issues no query at all on a path that runs on every
 * single sign-in.
 */
export async function applyPendingAllowance(
  userId: string,
  ssoSubject: string | null,
  email: string | null,
): Promise<number> {
  if (!deploymentPayerActive()) return 0
  try {
    const { data, error } = await supabase.rpc("apply_pending_deployment_allowance", {
      p_user_id: userId,
      p_sso_subject: ssoSubject?.trim() || null,
      p_email: email?.trim().toLowerCase() || null,
    })
    if (error) {
      console.warn("[deployment-allowance] pending apply failed (the sign-in is unaffected):", error.message)
      return 0
    }
    const applied = typeof data === "number" ? data : Number(data)
    if (!Number.isFinite(applied) || applied <= 0) return 0
    console.log(`[deployment-allowance] applied ${applied} pending allowance(s) at sign-in`)
    return applied
  } catch (e) {
    // A thrown error here would propagate into the SSO path and turn a working
    // sign-in into a 500 over a quota.
    console.warn(
      "[deployment-allowance] pending apply threw (the sign-in is unaffected):",
      e instanceof Error ? e.message : String(e),
    )
    return 0
  }
}

/**
 * Resolve "who is this?" from the three forms an integration may use.
 *
 * SUBJECT FIRST, email second, uuid accepted (the identity the customer's own
 * IdP asserts is the only one their back office reliably has). The subject is
 * matched against `auth.users.raw_app_meta_data`, the SERVICE-ROLE-ONLY copy
 * the SSO gate trusts — never the `user_metadata` twin, which a public
 * `signUp({ options: { data } })` can forge.
 *
 * AMBIGUOUS IS A REFUSAL. Two accounts answering to one address is a state the
 * customer has to resolve; allocating a paid quota to an arbitrary half of it
 * is the failure that costs money.
 *
 * A LOOKUP THAT COULD NOT BE PERFORMED IS `unavailable`, NOT `ambiguous`. Both
 * refuse to act — "we cannot tell which account this names" is never a licence
 * to act on one — but they are different facts and the caller does different
 * things with them: `ambiguous` is final and tells a back office to go and fix
 * a duplicated identity, while a dropped connection is a fault it should
 * simply retry. Answering the first for the second sends somebody editing an
 * identity provider over a network blip.
 *
 * The email match is EXACT and case-insensitive: `ilike` on the escaped
 * address (never a `%` pattern — `profiles.email` is user-supplied text and a
 * wildcard there is a filter-injection shaped bug), and the returned rows are
 * re-checked in TypeScript against the lower-cased address, so a pattern
 * metacharacter that survived escaping still cannot widen the match.
 */
export async function resolveUserRef(ref: UserRef): Promise<ResolvedUserRef> {
  const id = ref.id?.trim() || null
  const subject = ref.ssoSubject?.trim() || null
  const email = ref.email?.trim().toLowerCase() || null

  if (id) {
    const { data, error } = await supabase.from("profiles").select("id").eq("id", id).maybeSingle()
    if (error) {
      console.error("[deployment-allowance] user lookup by id failed:", error.message)
      return { kind: "unavailable" }
    }
    return data ? { kind: "user", userId: (data as { id: string }).id } : { kind: "absent" }
  }

  if (subject) {
    const { data, error } = await supabase.rpc("find_user_by_sso_subject", { p_subject: subject })
    if (error) {
      const raw = error.message ?? ""
      // NULL from this function means "no account". More than one account
      // carrying the subject RAISES (387), because the two are different
      // answers and the route does different things with them: `absent` stores
      // a pending intent against the identity, which for a duplicated subject
      // would land on whichever of the accounts signs in first. Prefix match,
      // like `classifyGrantError` — the raised text carries the subject after
      // the colon and a message merely containing the token is not one.
      if (raw.startsWith(SSO_SUBJECT_AMBIGUOUS_PREFIX)) {
        console.warn("[deployment-allowance] refusing a subject that names more than one account")
        return { kind: "ambiguous" }
      }
      console.error("[deployment-allowance] user lookup by subject failed:", raw)
      return { kind: "unavailable" }
    }
    const userId = typeof data === "string" ? data : null
    return userId ? { kind: "user", userId } : { kind: "absent" }
  }

  if (email) {
    // `*` is refused OUTRIGHT rather than escaped: PostgREST rewrites `*` to
    // `%` inside an `ilike` value and there is no escape that survives that
    // rewrite. The TypeScript re-check below would still keep the ANSWER
    // exact, but `limit(5)` could truncate the true match out of a widened
    // result set and turn a real account into `absent`. No address needs one.
    if (email.includes("*")) {
      // `invalid`, not `ambiguous`: nothing about the database is uncertain
      // here and no second account is implied. The address itself is one this
      // lookup cannot be performed with, which is a 400 the caller fixes by
      // sending a real address.
      console.warn("[deployment-allowance] refusing an email lookup containing a wildcard character")
      return { kind: "invalid" }
    }
    const escaped = email.replace(/[\\%_]/g, (c) => `\\${c}`)
    const { data, error } = await supabase.from("profiles").select("id, email").ilike("email", escaped).limit(5)
    if (error) {
      console.error("[deployment-allowance] user lookup by email failed:", error.message)
      return { kind: "unavailable" }
    }
    const rows = ((data ?? []) as ReadonlyArray<{ id: string; email: string | null }>).filter(
      (r) => (r.email ?? "").trim().toLowerCase() === email,
    )
    if (rows.length === 0) return { kind: "absent" }
    if (rows.length > 1) {
      console.warn("[deployment-allowance] refusing an ambiguous email — more than one account answers to it")
      return { kind: "ambiguous" }
    }
    return { kind: "user", userId: rows[0]!.id }
  }

  return { kind: "absent" }
}

/**
 * The trusted IdP subject for each of the given users that has one, so a page
 * of users costs one query rather than one per row.
 *
 * An id with no subject is simply absent from the map: the caller renders "not
 * federated", which is a different fact from "unknown". An unavailable read
 * answers an EMPTY map rather than null — every consumer of this decorates a
 * list it already has, and losing the decoration must not lose the list.
 */
export async function ssoSubjectsFor(userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!deploymentPayerActive()) return out
  const ids = [...new Set(userIds)].filter(Boolean)
  if (ids.length === 0) return out
  const { data, error } = await supabase.rpc("sso_subjects_for", { p_ids: ids })
  if (error) {
    console.error("[deployment-allowance] sso subject batch read failed:", error.message)
    return out
  }
  for (const row of (data ?? []) as ReadonlyArray<{ id?: string | null; sso_subject?: string | null }>) {
    if (typeof row.id === "string" && typeof row.sso_subject === "string" && row.sso_subject.length > 0) {
      out.set(row.id, row.sso_subject)
    }
  }
  return out
}

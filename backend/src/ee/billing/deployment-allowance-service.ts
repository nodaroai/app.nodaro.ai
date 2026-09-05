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
import type { AllowanceGrant, UserAllowance } from "../../types/deployment-allowance.js"

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
}

const ALLOWANCE_COLUMNS = "user_id, granted_credits, reserved_credits, spent_credits"

function fromRow(row: AllowanceRow): UserAllowance {
  const granted = row.granted_credits ?? 0
  const reserved = row.reserved_credits ?? 0
  const spent = row.spent_credits ?? 0
  // GREATEST(…, 0): the D2 clamp lets a metered overrun be absorbed into
  // `spent`, so remaining must floor at 0 rather than render a negative.
  return { granted, remaining: Math.max(granted - reserved - spent, 0), spent }
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
    .select("id, credits, kind, note, created_at")
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
  }>).map((r) => ({
    id: r.id,
    credits: r.credits ?? 0,
    kind: r.kind as AllowanceGrant["kind"],
    createdAt: r.created_at,
    note: r.note,
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
]

function classifyGrantError(raw: string): { code: AllowanceWriteErrorCode; message: string } {
  for (const [prefix, code] of GRANT_PREFIXES) {
    if (raw.startsWith(prefix)) return { code, message: raw }
  }
  return { code: "allowance_write_failed", message: raw }
}

/**
 * Move a user's `granted_credits`, through the RPC that is its only writer.
 *
 * All five parameters are supplied every time: `grant_deployment_allowance`
 * declares NO defaults, so an omitted one is a different arity and PostgREST
 * answers "function not found" — which would surface as a 500 on a top-up that
 * simply had no note.
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
}): Promise<AllowanceWriteResult> {
  const { error } = await supabase.rpc("grant_deployment_allowance", {
    p_user_id: params.userId,
    p_credits: params.credits,
    p_actor_id: params.actorId,
    p_kind: params.kind,
    p_note: params.note,
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

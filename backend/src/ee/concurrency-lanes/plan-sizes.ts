// backend/src/ee/concurrency-lanes/plan-sizes.ts — the Cloud reader of lane
// sizes, provider ceilings and waiting limits (migration 568), loaded by
// lib/concurrency-lanes/sizes.ts through a dynamic import behind hasCredits().
//
// A line is sized by its payer:
//   user:<id>        → that user's effective tier + their own override;
//   deployment:<id>  → the payer account's effective tier + the payer's override
//                      (every member of the deployment shares it);
//   workspace:<id>   → the plan row of the workspace's grade, which the caller
//                      passes as `subject.tier` (`entitlements.tierForGates`);
//                      no override.
// A Nodaro Connect install relays as its connected cloud account, so its users
// share that account's `user:` line; an admin raises it with the same override.
//
// Every read is cached 60 s with in-flight dedupe, so a size edit is seen
// within one TTL: each table whole (lane_user_overrides is a small admin-written
// table, so one query serves every account), and each account's profile tier.
// The only per-account query is that profile read. A bad row falls back to the
// code default of what it describes. A failed read keeps the last good value,
// or the code defaults when there is none; a failed tier read is retried after
// 5 s, and the fallback tier comes from the line asking, never from the cache. Staging runs dev code on
// the production database before 568 is applied there, so a missing table or
// column (42P01 / 42703 / PGRST204 / PGRST205) answers the code defaults, logged
// once per table per process; absence is not latched (the read is tried again
// after the TTL), so the tables are picked up the moment they exist.
import { config } from "../../lib/config.js"
import { FALLBACK_TIER as DEPLOYMENT_FALLBACK_TIER } from "../../lib/deployment-payer.js"
import { supabase } from "../../lib/supabase.js"
import { defaultLaneSizesForTier, LANE_PLAN_TIERS } from "../../lib/concurrency-lanes/defaults.js"
import { LIVE_WAIT_MAX_MINUTES } from "../../lib/concurrency-lanes/live-ceilings.js"
import { LANE_LIVE_WAIT_KEY, LANE_QUEUE_TIMEOUT_KEY } from "../../lib/concurrency-lanes/settings-keys.js"
import type { LaneSettings, LaneSubject } from "../../lib/concurrency-lanes/sizes.js"
import type { LaneSizes } from "../../lib/concurrency-lanes/types.js"
import { effectiveTierOf } from "../billing/org-entitlements.js"

const CACHE_TTL_MS = 60_000
/** How long a failed profile read stands before it is tried again. */
const FAILED_TIER_TTL_MS = 5_000
/** Per-account entries kept at most; expired ones are dropped first, then the oldest. */
const MAX_ACCOUNT_ENTRIES = 10_000
const MINUTE_MS = 60_000

const LANE_SIZE_MIN = 1
const LANE_SIZE_MAX = 500
const LANES = ["provider", "llm", "local", "run"] as const

export { LANE_LIVE_WAIT_KEY, LANE_QUEUE_TIMEOUT_KEY } from "../../lib/concurrency-lanes/settings-keys.js"
/** Admin ranges of the two waiting limits, in minutes (the live-wait maximum is provisional: live-ceilings.ts). */
export const LANE_QUEUE_TIMEOUT_RANGE = { min: 5, max: 1440 } as const
export const LANE_LIVE_WAIT_RANGE = { min: 1, max: LIVE_WAIT_MAX_MINUTES } as const
/** Lane sizes an admin may set (plan rows and overrides), as the 568 CHECKs. */
export const LANE_SIZE_RANGE = { min: LANE_SIZE_MIN, max: LANE_SIZE_MAX } as const

// ------------------------------------------------------------- read errors

/** 42P01 / PGRST205: no such table; 42703 / PGRST204: no such column. */
const MISSING_SCHEMA_CODES = new Set(["42P01", "PGRST205", "42703", "PGRST204"])
const OTHER_ERROR_WARN_EVERY_MS = 60_000

const loggedMissing = new Set<string>()
let lastOtherErrorWarnAt = -Infinity

class LaneConfigReadError extends Error {
  constructor(
    readonly table: string,
    readonly code: string | null,
    message: string,
  ) {
    super(message)
  }
}

function readError(table: string, error: { code?: string | null; message?: string }): LaneConfigReadError {
  return new LaneConfigReadError(table, error.code ?? null, error.message ?? "unknown error")
}

function noteReadFailure(err: unknown): void {
  if (err instanceof LaneConfigReadError && err.code && MISSING_SCHEMA_CODES.has(err.code)) {
    if (loggedMissing.has(err.table)) return
    loggedMissing.add(err.table)
    console.warn(`[concurrency-lanes] ${err.table} is not in this database yet (${err.code}); using the code defaults`)
    return
  }
  const now = Date.now()
  if (now - lastOtherErrorWarnAt < OTHER_ERROR_WARN_EVERY_MS) return
  lastOtherErrorWarnAt = now
  const where = err instanceof LaneConfigReadError ? err.table : "lane config"
  console.warn(`[concurrency-lanes] could not read ${where}, keeping the last good value or the code defaults: ${(err as Error)?.message ?? String(err)}`)
}

// -------------------------------------------------------------------- cache

interface Entry<T> { value: T; at: number; good: boolean }

/**
 * A cache with in-flight dedupe: a good read stands `ttlMs`, a failed one
 * `failedTtlMs`. A failed read keeps the last good value.
 */
class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly inflight = new Map<string, Promise<{ value: T; good: boolean }>>()
  private generation = 0

  constructor(
    private readonly maxEntries: number,
    private readonly failedTtlMs: number = CACHE_TTL_MS,
  ) {}

  private fresh(e: Entry<T>, now: number): boolean {
    return now - e.at < (e.good ? CACHE_TTL_MS : this.failedTtlMs)
  }

  async get(key: string, read: () => Promise<T>, fallback: () => T): Promise<T> {
    return (await this.getEntry(key, read, fallback)).value
  }

  /**
   * The value with whether it came from a good read (now or within the TTL,
   * or the last good value kept over a failure). `good: false` = the fallback,
   * because no read has succeeded yet; a cache hit on that answers false too.
   */
  async getEntry(key: string, read: () => Promise<T>, fallback: () => T): Promise<{ value: T; good: boolean }> {
    const hit = this.entries.get(key)
    if (hit && this.fresh(hit, Date.now())) return { value: hit.value, good: hit.good }
    const pending = this.inflight.get(key)
    if (pending) return pending
    const p = this.refresh(key, read, fallback, hit)
    this.inflight.set(key, p)
    try {
      return await p
    } finally {
      if (this.inflight.get(key) === p) this.inflight.delete(key)
    }
  }

  private async refresh(key: string, read: () => Promise<T>, fallback: () => T, previous: Entry<T> | undefined): Promise<{ value: T; good: boolean }> {
    const generation = this.generation
    let entry: Entry<T>
    try {
      entry = { value: await read(), at: Date.now(), good: true }
    } catch (err) {
      noteReadFailure(err)
      entry = previous?.good
        ? { value: previous.value, at: Date.now(), good: true }
        : { value: fallback(), at: Date.now(), good: false }
    }
    // A read that began before an invalidation must not store what it saw.
    if (generation === this.generation) {
      this.entries.delete(key) // re-insert at the end: insertion order is age order
      this.entries.set(key, entry)
      this.prune()
    }
    return { value: entry.value, good: entry.good }
  }

  private prune(): void {
    if (this.entries.size <= this.maxEntries) return
    const now = Date.now()
    for (const [k, e] of this.entries) if (!this.fresh(e, now)) this.entries.delete(k)
    for (const k of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break
      this.entries.delete(k)
    }
  }

  clear(): void {
    this.generation++
    this.entries.clear()
    this.inflight.clear()
  }
}

const planCache = new TtlCache<Readonly<Record<string, LaneSizes>>>(1)
const ceilingCache = new TtlCache<Readonly<Record<string, number>>>(1)
const settingsCache = new TtlCache<LaneSettings>(1)
const overrideCache = new TtlCache<ReadonlyMap<string, Readonly<Partial<LaneSizes>>>>(1)
/** What the profile read answers for an account with no profile row. */
const NO_PROFILE_ROW = Symbol("no profile row")

/**
 * Each account's effective tier, keyed by account id; `null` = the profile read
 * failed (kept 5 s), NO_PROFILE_ROW = the account has no profile. What those two
 * become depends on the line asking (its hint, or its kind's default), so it is
 * applied by the caller, never cached under the account.
 */
const tierCache = new TtlCache<string | null | typeof NO_PROFILE_ROW>(MAX_ACCOUNT_ENTRIES, FAILED_TIER_TTL_MS)

/**
 * Drop the cached lane configuration (plans, overrides, ceilings, settings), so
 * the next read sees the database after an admin edit. Profile tiers are kept:
 * a lane edit never changes one.
 */
export function invalidateLaneConfigCache(): void {
  planCache.clear()
  ceilingCache.clear()
  settingsCache.clear()
  overrideCache.clear()
}

/** For tests: also forget the cached profile tiers. */
export function resetLaneTierCacheForTests(): void {
  tierCache.clear()
}

/** For tests: forget which missing tables were already logged. */
export function resetLaneConfigLogForTests(): void {
  loggedMissing.clear()
  lastOtherErrorWarnAt = -Infinity
}

// ------------------------------------------------------------------ readers

function isLaneSize(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= LANE_SIZE_MIN && v <= LANE_SIZE_MAX
}

function minutesIn(v: unknown, range: { min: number; max: number }): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= range.min && v <= range.max ? v : null
}

/** The valid rows of lane_plan_sizes; a bad row is left out (its tier then uses the code default). */
async function readPlanRows(): Promise<Record<string, LaneSizes>> {
  const { data, error } = await supabase.from("lane_plan_sizes").select("tier, provider, llm, local, run")
  if (error) throw readError("lane_plan_sizes", error)
  const plans: Record<string, LaneSizes> = {}
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    if (typeof row.tier !== "string" || row.tier === "") continue
    if (!LANES.every((lane) => isLaneSize(row[lane]))) continue
    plans[row.tier] = { provider: row.provider as number, llm: row.llm as number, local: row.local as number, run: row.run as number }
  }
  return plans
}

async function readCeilings(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("lane_provider_ceilings").select("provider, ceiling")
  if (error) throw readError("lane_provider_ceilings", error)
  const ceilings: Record<string, number> = {}
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const c = row.ceiling
    if (typeof row.provider !== "string" || row.provider === "") continue
    if (typeof c !== "number" || !Number.isInteger(c) || c < 1) continue
    ceilings[row.provider] = c
  }
  return ceilings
}

function envSettings(): LaneSettings {
  return {
    queueTimeoutMs: config.LANE_QUEUE_TIMEOUT_MINUTES * MINUTE_MS,
    liveWaitLimitMs: config.LANE_LIVE_WAIT_MINUTES * MINUTE_MS,
  }
}

async function readSettings(): Promise<LaneSettings> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", [LANE_QUEUE_TIMEOUT_KEY, LANE_LIVE_WAIT_KEY])
  if (error) throw readError("app_settings", error)
  const byKey = new Map(((data ?? []) as Array<{ key: string; value: unknown }>).map((r) => [r.key, r.value]))
  const queue = minutesIn(byKey.get(LANE_QUEUE_TIMEOUT_KEY), LANE_QUEUE_TIMEOUT_RANGE) ?? config.LANE_QUEUE_TIMEOUT_MINUTES
  const live = minutesIn(byKey.get(LANE_LIVE_WAIT_KEY), LANE_LIVE_WAIT_RANGE) ?? config.LANE_LIVE_WAIT_MINUTES
  return { queueTimeoutMs: queue * MINUTE_MS, liveWaitLimitMs: live * MINUTE_MS }
}

/** An account's effective tier (payg derived), read as billing reads it; NO_PROFILE_ROW when it has no profile. */
async function readAccountTier(accountId: string): Promise<string | typeof NO_PROFILE_ROW> {
  const { data, error } = await supabase
    .from("profiles")
    .select("tier, subscription_tier, lifetime_topup_credits")
    .eq("id", accountId)
    .maybeSingle()
  if (error) throw readError("profiles", error)
  if (!data) return NO_PROFILE_ROW
  const row = data as { tier?: string | null; subscription_tier?: string | null; lifetime_topup_credits?: number | null }
  return effectiveTierOf({
    tier: row.tier ?? null,
    subscription_tier: row.subscription_tier ?? null,
    lifetime_topup_credits: row.lifetime_topup_credits ?? 0,
  })
}

/**
 * Every override, by account: the lanes each sets. NULL or invalid columns are
 * left out (those lanes follow the plan); a row that sets none is left out.
 */
async function readOverrides(): Promise<Map<string, Partial<LaneSizes>>> {
  const { data, error } = await supabase.from("lane_user_overrides").select("user_id, provider, llm, local, run")
  if (error) throw readError("lane_user_overrides", error)
  const out = new Map<string, Partial<LaneSizes>>()
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    if (typeof row.user_id !== "string") continue
    const o: Partial<LaneSizes> = {}
    for (const lane of LANES) if (isLaneSize(row[lane])) o[lane] = row[lane] as number
    if (Object.keys(o).length > 0) out.set(row.user_id, o)
  }
  return out
}

// ------------------------------------------------------------------- public

function planRows(): Promise<Readonly<Record<string, LaneSizes>>> {
  return planCache.get("plans", readPlanRows, () => ({}))
}

function sizesOfTier(plans: Readonly<Record<string, LaneSizes>>, tier: string): LaneSizes {
  const row = Object.hasOwn(plans, tier) ? plans[tier] : undefined
  return row ? { ...row } : defaultLaneSizesForTier(tier)
}

/** A tier with sizes of its own: a plan row, or a code default. */
function isSizedTier(plans: Readonly<Record<string, LaneSizes>>, tier: string): boolean {
  return Object.hasOwn(plans, tier) || (LANE_PLAN_TIERS as readonly string[]).includes(tier)
}

function accountOf(payer: LaneSubject["payer"]): { kind: "user" | "workspace" | "deployment"; id: string } {
  const i = payer.indexOf(":")
  const kind = payer.slice(0, i)
  const id = payer.slice(i + 1)
  if (kind === "user" || kind === "workspace" || kind === "deployment") return { kind, id }
  throw new Error(`unknown payer: ${payer}`)
}

/** The sizes of one (user, payer) line. */
export async function cloudLaneSizesFor(subject: LaneSubject): Promise<LaneSizes> {
  const { kind, id } = accountOf(subject.payer)
  if (kind === "workspace") return sizesOfTier(await planRows(), subject.tier ?? "business")
  // user: and deployment: — the paying account's own tier and override. A
  // failed profile read uses the line's hint, else its kind's default: free for
  // a person, the smallest paid grade for a deployment payer (never free).
  const fallbackTier = subject.tier ?? (kind === "deployment" ? DEPLOYMENT_FALLBACK_TIER : "free")
  const [plans, read, overrides] = await Promise.all([
    planRows(),
    tierCache.get(id, () => readAccountTier(id), () => null),
    overrideCache.get("overrides", readOverrides, () => new Map()),
  ])
  // A person with no profile is free, as billing reads it; a deployment payer
  // with none is sized as a failed read (deployment-payer.ts derives no grade
  // from a missing row either).
  const tier = read === null ? fallbackTier : read === NO_PROFILE_ROW ? (kind === "user" ? "free" : fallbackTier) : read
  // A deployment line on a tier with no sizes of its own (an unknown or retired
  // one, or a hint that is) runs at the deployment payer's fallback grade, as
  // deployment-payer.ts sizes its parallelism — never free.
  const sized = kind === "deployment" && !isSizedTier(plans, tier) ? DEPLOYMENT_FALLBACK_TIER : tier
  return { ...sizesOfTier(plans, sized), ...overrides.get(id) }
}

/** Every plan's sizes (each lane plan tier, plus any extra row): the table over the code defaults. */
export async function cloudPlanSizes(): Promise<Record<string, LaneSizes>> {
  const plans = await planRows()
  const out: Record<string, LaneSizes> = {}
  for (const tier of LANE_PLAN_TIERS) out[tier] = sizesOfTier(plans, tier)
  for (const tier of Object.keys(plans)) out[tier] ??= sizesOfTier(plans, tier)
  return out
}

/** The admin-set platform ceilings (provider id → running at most); a provider absent has none. */
export async function cloudProviderCeilings(): Promise<Record<string, number>> {
  return { ...(await ceilingCache.get("ceilings", readCeilings, () => ({}))) }
}

/**
 * The ceilings as a read of the table saw them (or the last good read within
 * its keep); throws when there is none — the table could not be read and no
 * good read is cached. An empty table answers `{}`. What the gate's copy is
 * replaced with: a failed read must not clear every ceiling there.
 */
export async function cloudProviderCeilingsAsRead(): Promise<Record<string, number>> {
  const { value, good } = await ceilingCache.getEntry("ceilings", readCeilings, () => ({}))
  if (!good) throw new Error("the provider ceilings could not be read")
  return { ...value }
}

/** The admin-set waiting limits; a missing or out-of-range value uses the env minutes. */
export async function cloudLaneSettings(): Promise<LaneSettings> {
  return { ...(await settingsCache.get("settings", readSettings, envSettings)) }
}

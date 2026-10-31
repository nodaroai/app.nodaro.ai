// backend/src/lib/concurrency-lanes/enforcement.ts — the `lanes_enforced`
// switch: where it is stored, how it reaches the gate, and what must be true
// before it is turned on.
//
// Stored: `app_settings.lanes_enforced`, a map of runtime environment →
// boolean (staging and production share one database; each environment reads
// and writes only its own key — getRuntimeEnv()). With no boolean for this
// environment, LANES_ENFORCED applies; with neither, lanes are off. In this
// release none of that can turn them on: LANES_ENFORCEMENT_AVAILABLE is false
// (enforcement-available.ts), so the setting reads as off whatever is stored,
// and a request to turn it on is refused (LanesNotAvailableError).
//
// Mirrored: every 30 s the setting is copied into the gate's Redis flag, which
// every acquire reads atomically, and the provider ceilings into the gate. The
// admin route also writes the flag at once. An on→off edge (seen by the route,
// or by the mirror after a database edit, an env change or a PUT handled by
// another process) wakes every waiting job through the registered waker.
//
// Versioned: the flag is written with the setting row's `updated_at`, and the
// gate ignores a version older than the one it holds — so a mirror pass that
// read the row before an admin's write can never undo it. The gate answers the
// flag it replaced in the same script, so of every mirror applying one off
// exactly one sees the edge and wakes the waiters. An admin's explicit off
// always wakes, edge or not (waking is idempotent: promoting a job that is not
// delayed is a no-op). Every write of the row moves `updated_at` forward, also
// on a clock behind the row's.
//
// The mirror never stops: a database or Redis error skips that step for the
// tick (logged at most once a minute) and the next tick tries again. A failed
// read never counts as "off": it leaves the Redis flag as it is.
import { config } from "../config.js"
import { getRuntimeEnv } from "../runtime-env.js"
import { supabase } from "../supabase.js"
import { LANES_ENFORCEMENT_AVAILABLE } from "./enforcement-available.js"
import { concurrencyGate } from "./instance.js"
import { LIVE_CEILINGS_MEASURED } from "./live-ceilings.js"
import { pluginJobTypesKnown, pluginLoadFailed, undeclaredPluginJobTypes } from "./registry.js"
import { LANES_ENFORCED_KEY } from "./settings-keys.js"
import { noteEnforcedApplied, providerCeilingsForGate } from "./sizes.js"

export { LANES_ENFORCED_KEY } from "./settings-keys.js"
export { lastMirroredEnforced } from "./sizes.js"
/** How often the mirror copies the setting and the ceilings into Redis. */
export const ENFORCEMENT_MIRROR_INTERVAL_MS = 30_000
/** Days of measure-only data the switch asks for before it is turned on. */
export const MIN_MEASURE_DAYS = 7

// ------------------------------------------------------------------ hooks

let offTransitionWaker: () => Promise<number> = async () => 0
let measureDaysReader: () => Promise<number> = async () => 0

/**
 * What wakes every waiting job when enforcement goes off (the park module
 * registers its wake-all). Returns how many it woke. Until one is registered,
 * nothing parks, so there is nothing to wake.
 */
export function registerOffTransitionWaker(fn: () => Promise<number>): void {
  offTransitionWaker = fn
}

/**
 * How many days of measure-only data this environment has (the daily usage
 * history registers its reader). Until one is registered there is none: 0.
 */
export function registerMeasureDaysReader(fn: () => Promise<number>): void {
  measureDaysReader = fn
}

/** For tests: the default hooks again. */
export function resetEnforcementHooksForTests(): void {
  offTransitionWaker = async () => 0
  measureDaysReader = async () => 0
}

// -------------------------------------------------------------- logging

const WARN_EVERY_MS = 60_000
const lastWarnAt = new Map<string, number>()

function warnRateLimited(what: string, err: unknown): void {
  const now = Date.now()
  if (now - (lastWarnAt.get(what) ?? -Infinity) < WARN_EVERY_MS) return
  lastWarnAt.set(what, now)
  console.warn(`[concurrency-lanes] ${what}: ${(err as Error)?.message ?? String(err)}`)
}

// -------------------------------------------------------------- the setting

/** Turning concurrency limits on is not available in this release (enforcement-available.ts). */
export class LanesNotAvailableError extends Error {
  readonly code = "not_available_yet"
  constructor() {
    super("Concurrency limits cannot be turned on in this release.")
    this.name = "LanesNotAvailableError"
  }
}

/** Whether concurrency limits may be turned on in this release. */
export function lanesEnforcementAvailable(): boolean {
  return LANES_ENFORCEMENT_AVAILABLE
}

type EnforcedMap = Record<string, unknown>

function asMap(value: unknown): EnforcedMap {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? { ...(value as EnforcedMap) } : {}
}

/** A row's `updated_at` as the flag's version (ms); 0 for no row or an unreadable stamp. */
function versionOf(updatedAt: unknown): number {
  const ms = typeof updatedAt === "string" ? Date.parse(updatedAt) : Number.NaN
  return Number.isFinite(ms) ? ms : 0
}

/**
 * This environment's setting with its version: its boolean in the map, else
 * LANES_ENFORCED — and off, whatever either says, while turning limits on is
 * not available; the version is the row's `updated_at` (0 with no row), so an
 * "off" copied this way still replaces an "on" the gate holds at that version.
 * Throws when the database cannot be read — the caller must not treat that as "off".
 */
async function readLanesEnforcedVersioned(): Promise<{ on: boolean; version: number }> {
  const { data, error } = await supabase.from("app_settings").select("value, updated_at").eq("key", LANES_ENFORCED_KEY).maybeSingle()
  if (error) throw new Error(`could not read ${LANES_ENFORCED_KEY}: ${error.message ?? "unknown error"}`)
  const row = data as { value?: unknown; updated_at?: unknown } | null
  const own = asMap(row?.value)[getRuntimeEnv()]
  const stored = typeof own === "boolean" ? own : config.LANES_ENFORCED === true
  return { on: lanesEnforcementAvailable() && stored, version: versionOf(row?.updated_at) }
}

/**
 * Whether this environment's setting is on: its boolean in the map, else
 * LANES_ENFORCED. Throws when the database cannot be read — the caller must
 * not treat that as "off".
 */
export async function readLanesEnforcedSetting(): Promise<boolean> {
  return (await readLanesEnforcedVersioned()).on
}

const WRITE_ATTEMPTS = 4

/**
 * Set this environment's key, keeping every other environment's: a
 * compare-and-swap on the row's `updated_at`, so a concurrent write from the
 * other environment is never overwritten. The new `updated_at` is always
 * later than the row's (by 1 ms when this clock is behind it), so it is a
 * version newer than any the gate holds. Returns that version.
 */
async function writeOwnKey(on: boolean, actorId: string): Promise<number> {
  const env = getRuntimeEnv()
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value, updated_at")
      .eq("key", LANES_ENFORCED_KEY)
      .maybeSingle()
    if (error) throw new Error(`could not read ${LANES_ENFORCED_KEY}: ${error.message ?? "unknown error"}`)
    if (!data) {
      const now = new Date().toISOString()
      const ins = await supabase.from("app_settings").insert({ key: LANES_ENFORCED_KEY, value: { [env]: on }, updated_at: now, updated_by: actorId })
      if (!ins.error) return versionOf(now)
      if (ins.error.code === "23505") continue // the other environment created it first
      throw new Error(`could not write ${LANES_ENFORCED_KEY}: ${ins.error.message ?? "unknown error"}`)
    }
    const row = data as { value: unknown; updated_at: string }
    const value = { ...asMap(row.value), [env]: on }
    const stamp = new Date(Math.max(Date.now(), versionOf(row.updated_at) + 1)).toISOString()
    const upd = await supabase
      .from("app_settings")
      .update({ value, updated_at: stamp, updated_by: actorId })
      .eq("key", LANES_ENFORCED_KEY)
      .eq("updated_at", row.updated_at)
      .select("key, updated_at")
    if (upd.error) throw new Error(`could not write ${LANES_ENFORCED_KEY}: ${upd.error.message ?? "unknown error"}`)
    if (Array.isArray(upd.data) && upd.data.length > 0) {
      return versionOf((upd.data[0] as { updated_at?: unknown }).updated_at) || versionOf(stamp)
    }
    // Someone wrote the row between the read and the update: read it again.
  }
  throw new Error(`could not write ${LANES_ENFORCED_KEY}: the row kept changing`)
}

/**
 * Copy `target` at `version` into the gate's flag, and wake every waiter —
 * after the flag is off, so no woken waiter re-checks into an enforced gate
 * and parks again — when this write turned it from on to off, or, with
 * `wakeWhenOff` (an admin's explicit off), whenever the flag ends off. A stale
 * version changes nothing, and the value noted in-process is the gate's.
 */
async function applyToGate(target: boolean, version: number, wakeWhenOff: boolean): Promise<number> {
  const { was, enforced } = await concurrencyGate().setEnforced(target, version)
  noteEnforcedApplied(enforced)
  if (enforced) return 0
  return was || (wakeWhenOff && !target) ? offTransitionWaker() : 0
}

/**
 * Turn enforcement on or off in THIS environment: write its key, copy it into
 * Redis at once, and on off wake every waiting job (also when the flag was
 * already off: waking is idempotent). Turning it on throws
 * LanesNotAvailableError, before anything is written, while that is not
 * available; turning it off is always allowed. Otherwise throws only when the
 * setting could not be saved; when it was saved but Redis could not be
 * reached, `mirrored` is false and the mirror applies it within one interval
 * (an off is then seen as an edge and wakes the waiters).
 */
export async function setLanesEnforced(on: boolean, actorId: string): Promise<{ woke: number; mirrored: boolean }> {
  if (on && !lanesEnforcementAvailable()) throw new LanesNotAvailableError()
  const version = await writeOwnKey(on, actorId)
  try {
    return { woke: await applyToGate(on, version, true), mirrored: true }
  } catch (err) {
    warnRateLimited("could not copy the enforcement switch into Redis; the mirror retries", err)
    return { woke: 0, mirrored: false }
  }
}

// ------------------------------------------------------------- the mirror

/**
 * One mirror pass: the setting into the flag (with the off-edge wake), then the
 * ceilings into the gate. The value copied is also kept in-process
 * (`lastMirroredEnforced`) for reads that must not call Redis.
 */
export async function mirrorEnforcementOnce(): Promise<void> {
  let target: { on: boolean; version: number } | null = null
  try {
    target = await readLanesEnforcedVersioned()
  } catch (err) {
    warnRateLimited("enforcement mirror: the setting could not be read, the flag is left as it is", err)
  }
  if (target !== null) {
    try {
      await applyToGate(target.on, target.version, false)
    } catch (err) {
      warnRateLimited("enforcement mirror: could not copy the switch into Redis", err)
    }
  }
  try {
    // A failed read skips the copy for this tick: replacing the gate's map with
    // `{}` would clear every ceiling the table holds.
    const ceilings = await providerCeilingsForGate()
    if (ceilings !== null) await concurrencyGate().setProviderCeilings(ceilings)
  } catch (err) {
    warnRateLimited("enforcement mirror: could not copy the provider ceilings into Redis", err)
  }
}

/**
 * Start the mirror: one pass now, then one every 30 s after the previous one
 * ends (passes never overlap, however slow Redis is). The timer does not keep
 * the process alive. Returns the stop function.
 */
export function startEnforcementMirror(): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = async (): Promise<void> => {
    try {
      await mirrorEnforcementOnce()
    } catch (err) {
      warnRateLimited("enforcement mirror", err)
    }
    if (stopped) return
    timer = setTimeout(() => void tick(), ENFORCEMENT_MIRROR_INTERVAL_MS)
    timer.unref?.()
  }
  void tick()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}

// ---------------------------------------------------------- preconditions

/** What the switch lists before enforcement is turned on. */
export interface EnforcementPreconditions {
  /** Turning limits on is available in this release at all (false: the switch refuses on, whatever else is met). */
  available: boolean
  /** The lane columns and tables of migration 568 are in this database. */
  columnsPresent: boolean
  /** Whether this process has recorded its plugin job types (until then the list below proves nothing). */
  pluginTypesKnown: boolean
  /** Plugin job types with no lane declaration. */
  undeclaredPluginTypes: string[]
  /** The plugins failed to load in this process, so its plugin job types were never checked (unmet when true). */
  pluginLoadFailed?: boolean
  /** The live-wait ceiling comes from a measurement. */
  liveCeilingMeasured: boolean
  /** Days of measure-only data in this environment. */
  measureDays: number
}

/** 42P01 / PGRST205: no such table; 42703 / PGRST204: no such column. */
const MISSING_SCHEMA_CODES = new Set(["42P01", "PGRST205", "42703", "PGRST204"])

/** Every table migration 568 adds to or creates, with the columns it adds. */
const LANE_SCHEMA: ReadonlyArray<readonly [string, string]> = [
  ["jobs", "lane_queued_at, lane_env, lane_env_id, lane_bull_queue, lane_bull_job_id, lane_wait_ms"],
  ["workflow_executions", "lane_queued_at, lane_env, lane_env_id, lane_wait_ms"],
  ["pipelines", "lane_queued_at, lane_env, lane_env_id, lane_wait_ms"],
  ["lane_plan_sizes", "tier, provider, llm, local, run"],
  ["lane_user_overrides", "user_id, provider, llm, local, run, note"],
  ["lane_provider_ceilings", "provider, ceiling"],
  ["lane_requeue_payloads", "kind, row_id, bull_queue, bull_job_id, name, data, opts"],
]

/** Whether every lane column and table is in this database (a zero-row select of each). Any error reads as absent. */
async function laneSchemaPresent(): Promise<boolean> {
  const results = await Promise.all(LANE_SCHEMA.map(async ([table, columns]) => {
    try {
      const { error } = await supabase.from(table).select(columns).limit(0)
      if (!error) return true
      if (!error.code || !MISSING_SCHEMA_CODES.has(error.code)) warnRateLimited(`could not check the lane columns of ${table}`, error)
      return false
    } catch (err) {
      warnRateLimited(`could not check the lane columns of ${table}`, err)
      return false
    }
  }))
  return results.every(Boolean)
}

async function measureDays(): Promise<number> {
  try {
    const days = await measureDaysReader()
    return Number.isFinite(days) && days > 0 ? Math.floor(days) : 0
  } catch (err) {
    warnRateLimited("could not read the days of measure-only data", err)
    return 0
  }
}

export async function enforcementPreconditions(): Promise<EnforcementPreconditions> {
  const [columnsPresent, days] = await Promise.all([laneSchemaPresent(), measureDays()])
  return {
    available: lanesEnforcementAvailable(),
    columnsPresent,
    pluginTypesKnown: pluginJobTypesKnown(),
    undeclaredPluginTypes: undeclaredPluginJobTypes(),
    pluginLoadFailed: pluginLoadFailed(),
    liveCeilingMeasured: LIVE_CEILINGS_MEASURED,
    measureDays: days,
  }
}

export type EnforcementPrecondition = "available" | "columns" | "plugins" | "liveCeiling" | "measureDays"

/** The preconditions not met, in the order the switch lists them; empty = all met. */
export function unmetPreconditions(p: EnforcementPreconditions): EnforcementPrecondition[] {
  const unmet: EnforcementPrecondition[] = []
  if (!p.available) unmet.push("available")
  if (!p.columnsPresent) unmet.push("columns")
  if (!p.pluginTypesKnown || p.undeclaredPluginTypes.length > 0 || p.pluginLoadFailed === true) unmet.push("plugins")
  if (!p.liveCeilingMeasured) unmet.push("liveCeiling")
  if (p.measureDays < MIN_MEASURE_DAYS) unmet.push("measureDays")
  return unmet
}

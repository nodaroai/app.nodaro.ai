/**
 * Watching the alternate route's money (Cloud only; docs/design/alternate-routes.md,
 * "Routing per model"). Alerts and reports only — nothing here changes a
 * price, a route or a charge, and nothing throws to its caller.
 *
 *  - BALANCES (hourly, once per environment): the route's prepaid account
 *    (`account()`) against the admin's `routeBalanceAlertUsd`, and the default
 *    provider's latest snapshotted balance against
 *    `defaultProviderBalanceAlertCredits`. Below its number, an `[ALERT]`, at
 *    most once per {@link BALANCE_ALERT_EVERY_MS} per account. Unset = none.
 *  - DAILY RECONCILIATION (once per environment): the verified bills this
 *    environment's ledger RECORDED in a UTC day (a bill counts on the day it
 *    was recorded: one that arrives after its task's row was written lands on
 *    the day it arrived) — the cost on runs that were charged, and, on a line
 *    of its own, the cost on sends that were not (known losses: a run that
 *    failed or was cancelled, a replaced send, a send given up on whose bill
 *    arrived) — beside what the route reports its account spent that whole
 *    UTC day (`spend()` counts whole UTC days).
 *    The route's account is SHARED: staging and production share it, and so
 *    does traffic that never reaches this ledger. So the account's figure is
 *    CONTEXT only, and the remainder above this environment's ledger
 *    (`unexplainedUsd`) can never be attributed to it and alerts nothing. The
 *    one comparison that IS this environment's own: its ledger recording MORE
 *    than the whole account spent (past the admin's `spendDriftAlertPercent`
 *    and a small allowance for runs straddling midnight) — then its recorded
 *    bills are wrong, and that is an `[ALERT]`. Unreported bills, unresolved
 *    sends and known losses are alerted from the ledger itself. Nothing here
 *    raises a price: the per-job settlement does that from each run's own
 *    billed figure.
 */
import { recordVideoRouteAlert } from "./video-route-alerts.js"
import { RUNTIME_ENV_NAMEABLE, supabase } from "../../lib/supabase.js"
import { getAppSettings } from "../../lib/app-settings.js"
import { getRuntimeEnv } from "../../lib/runtime-env.js"
import { getPluginServices } from "../../lib/private-plugins/services-registry.js"
import { VIDEO_ROUTE_POLICY_DEFAULTS, unpaidChargesEnforced } from "../../lib/video-route-policy.js"
import { updateSettingsRow, videoRouteSpendDaysKey } from "../../lib/video-route-policy-store.js"
import { billedAtOf, countHeldRouteSettles, countLateBills, countStuckDeferredRepayments, envWroteLedgerSince, readOtherEnvOpenSettles, verifiedTaskUsd } from "../../lib/video-route-ledger.js"
import { fetchKieCreditSnapshotsSince } from "../routes/admin-kie-credits.js"

/** One balance alert per account at most this often. */
export const BALANCE_ALERT_EVERY_MS = 6 * 3_600_000
/** Days of reconciliation kept per environment. */
export const SPEND_DAYS_KEPT = 30
/** A run that straddles midnight bills on one side and records on the other: this much of a difference is not drift. */
export const MIDNIGHT_STRADDLE_ALLOWANCE_USD = 0.5
/** The jobs read per page (every page is read: nothing is silently cut off). */
const PAGE = 1000

const lastBalanceAlert = new Map<string, number>()

function alertThrottled(key: string, now: number): boolean {
  const last = lastBalanceAlert.get(key)
  if (last !== undefined && now - last < BALANCE_ALERT_EVERY_MS) return true
  return false
}

export interface BalanceCheck {
  route: { availableUsd: number; heldUsd: number; observedAt: string } | null
  defaultProviderCredits: number | null
  alerted: string[]
}

/** Both balances as they stand (the route's live account, the default provider's latest snapshot). Never throws. */
export async function readBalances(): Promise<Pick<BalanceCheck, "route" | "defaultProviderCredits">> {
  const service = getPluginServices().alternateRoutes
  const route = typeof service?.account === "function" ? await service.account().catch(() => null) : null
  const snapshots = await fetchKieCreditSnapshotsSince(3).catch(() => [])
  const latest = snapshots.at(-1)
  return { route, defaultProviderCredits: latest ? latest.credits : null }
}

/** The hourly balance check. Never throws. */
export async function checkRouteBalances(now = Date.now()): Promise<BalanceCheck> {
  const out: BalanceCheck = { route: null, defaultProviderCredits: null, alerted: [] }
  try {
    const policy = (await getAppSettings()).video_route_policy
    Object.assign(out, await readBalances())
    const routeFloor = policy?.routeBalanceAlertUsd
    if (out.route && typeof routeFloor === "number" && out.route.availableUsd < routeFloor && !alertThrottled("route", now)) {
      console.error(`[ALERT] video route: the alternate route's account holds ${out.route.availableUsd.toFixed(2)} USD (below the ${routeFloor.toFixed(2)} USD set in Admin; ${out.route.heldUsd.toFixed(2)} USD held by running tasks).`)
      await recordVideoRouteAlert({ key: "balance:route", kind: "balance", message: `Alternate route balance ${out.route.availableUsd.toFixed(2)} USD is below the configured ${routeFloor.toFixed(2)} USD threshold.` })
      lastBalanceAlert.set("route", now)
      out.alerted.push("route")
    }
    const defaultFloor = policy?.defaultProviderBalanceAlertCredits
    if (out.defaultProviderCredits !== null && typeof defaultFloor === "number" && out.defaultProviderCredits < defaultFloor && !alertThrottled("default", now)) {
      console.error(`[ALERT] the default video provider's account holds ${out.defaultProviderCredits} of its credits (below the ${defaultFloor} set in Admin → Video route).`)
      await recordVideoRouteAlert({ key: "balance:default", kind: "balance", message: `Default provider balance ${out.defaultProviderCredits} is below the configured ${defaultFloor} credit threshold.` })
      lastBalanceAlert.set("default", now)
      out.alerted.push("default")
    }
  } catch (err) {
    console.error(`[video-route] balance check failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  return out
}

export interface SpendDay {
  day: string
  /** Cost recorded on the routed jobs that completed that day. */
  recordedUsd: number
  /** Cost recorded on routed jobs that failed after the route billed them (refunded to the person): known losses. */
  lossesUsd: number
  /** What the route reports it spent that whole UTC day. */
  actualUsd: number | null
  videoSeconds: number | null
  /** What the shared account spent beyond this environment's ledger: actual − recorded − losses (null with no route figure). Context only: never attributed to this environment, never alerted. */
  unexplainedUsd: number | null
  /** What this environment's ledger recorded beyond the WHOLE shared account's spend (0 when none; null with no route figure): the one drift that is this environment's own. */
  overRecordedUsd?: number | null
  jobs: number
  failedJobs: number
  at: string
}

/** The UTC day before `now`, as `YYYY-MM-DD`, and its bounds. */
export function previousUtcDay(now: Date): { day: string; start: Date; end: Date } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const start = new Date(end.getTime() - 86_400_000)
  return { day: start.toISOString().slice(0, 10), start, end }
}

/** Whether what is unexplained is past the threshold (and the midnight allowance). */
export function spendDrifted(recordedUsd: number, unexplainedUsd: number, percent: number): boolean {
  return unexplainedUsd > Math.max(recordedUsd * (percent / 100), MIDNIGHT_STRADDLE_ALLOWANCE_USD)
}

/**
 * The tasks the route ledger holds for this environment that belong to the day
 * [start, end), with the status of the job each belongs to: a task whose bill
 * was recorded that day (`detail.billedAt`, or its row's `created_at` when the
 * bill went on with the row), and a task written that day with no bill yet
 * (unreported, unresolved). A bill recorded on another day is that day's, so
 * every bill is counted on exactly one day — the day it was recorded. A job's
 * own sends and a plugin run's segments (rows of their parent) are each there:
 * the ledger, not `jobs.provider_cost`.
 */
async function ledgerTasksBetween(start: Date, end: Date): Promise<Array<{ jobId: string; billedUsd: number | null; outcome: string | null; ownLoss: boolean; status: string | null }>> {
  const env = getRuntimeEnv()
  type TaskRow = { id: number; job_id: string; billed_usd: unknown; cost_basis: unknown; outcome?: unknown; detail?: unknown; created_at?: unknown }
  const byId = new Map<number, TaskRow>()
  // Two reads of the day: rows written in it, and rows whose bill was recorded in it.
  for (const column of ["created_at", "detail->>billedAt"] as const) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await (supabase.from("video_route_ledger" as "assets") as unknown as { select(c: string): any })
        .select("id, job_id, billed_usd, cost_basis, outcome, detail, created_at")
        .eq("env", env)
        .eq("kind", "task")
        .gte(column, start.toISOString())
        .lt(column, end.toISOString())
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw new Error(error.message)
      const page = (data ?? []) as TaskRow[]
      for (const t of page) byId.set(t.id, t)
      if (page.length < PAGE) break
    }
  }
  const inDay = (iso: string | undefined): boolean => {
    const at = iso ? Date.parse(iso) : NaN
    return Number.isFinite(at) && at >= start.getTime() && at < end.getTime()
  }
  const tasks = [...byId.values()].filter((t) => {
    // A bill is counted on the day it was recorded; a row with no bill on the day it was written.
    const billedAt = verifiedTaskUsd(t) !== null ? (billedAtOf(t.detail) ?? (typeof t.created_at === "string" ? t.created_at : undefined)) : (typeof t.created_at === "string" ? t.created_at : undefined)
    return inDay(billedAt)
  })
  const ids = [...new Set(tasks.map((t) => t.job_id))]
  const status = new Map<string, string>()
  for (let i = 0; i < ids.length; i += PAGE) {
    // trash-read: money that was spent, whatever became of the job since.
    const { data, error } = await supabase.from("jobs").select("id, status").in("id", ids.slice(i, i + PAGE))
    if (error) throw new Error(error.message)
    for (const r of (data ?? []) as Array<{ id: string; status: string }>) status.set(r.id, r.status)
  }
  // The verified bill each task settles at (a money receipt, or billed seconds at the agreed rate): what this day's total is held against.
  return tasks.map((t) => ({ jobId: t.job_id, billedUsd: verifiedTaskUsd(t), outcome: typeof t.outcome === "string" ? t.outcome : null, ownLoss: (t.detail as { ownLoss?: unknown } | null)?.ownLoss === true, status: status.get(t.job_id) ?? null }))
}

/**
 * Reconciles the UTC day before `now` for this environment and keeps the
 * result. Never throws; null when there is no route service here or no
 * routing was ever saved.
 */
export async function reconcileRouteSpend(now = new Date()): Promise<SpendDay | null> {
  try {
    const service = getPluginServices().alternateRoutes
    if (typeof service?.spend !== "function") return null
    const settings = await getAppSettings()
    if (!settings.video_route_policy) return null
    const { day, start, end } = previousUtcDay(now)

    let recordedUsd = 0
    let lossesUsd = 0
    let unreported = 0
    const delivered = new Set<string>()
    const lost = new Set<string>()
    let unresolved = 0
    const unresolvedJobs = new Set<string>()
    for (const task of await ledgerTasksBetween(start, end)) {
      // A send the route ended with no result was not billed: nothing to report.
      if (task.outcome === "failed" || task.outcome === "expired") continue
      // A send that started and could never be read to an end, with no bill: a possible charge nothing here accounts for.
      if (task.outcome === "unresolved" && task.billedUsd === null) {
        unresolved++
        unresolvedJobs.add(task.jobId)
        continue
      }
      if (task.billedUsd === null) {
        unreported++
        continue
      }
      // A task of a job that failed or was cancelled was refunded to its owner, a delivered send that
      // was replaced after a step of ours failed was never charged, and a send given up on whose bill
      // arrived is never charged: known losses.
      if (task.status === "failed" || task.status === "cancelled" || task.ownLoss || task.outcome === "unresolved") {
        lost.add(task.jobId)
        lossesUsd += task.billedUsd
      } else {
        delivered.add(task.jobId)
        recordedUsd += task.billedUsd
      }
    }
    const jobs = delivered.size
    const failedJobs = lost.size
    if (unresolved > 0) {
      const message = `${unresolved} routed send(s) on ${day} started and could not be read to an end (${unresolvedJobs.size} job(s): ${[...unresolvedJobs].slice(0, 10).join(", ")}${unresolvedJobs.size > 10 ? ", …" : ""}). They were not charged; the route may have billed them.`
      console.error(`[ALERT] video route: ${message}`)
      await recordVideoRouteAlert({ key: `unresolved-sends:${day}`, kind: "reconciliation", message })
    }
    if (unreported > 0) await recordVideoRouteAlert({ key: `missing-receipts:${day}`, kind: "reconciliation", message: `${unreported} routed tasks on ${day} reported no verified bill. Their settlement is pending.` })

    // The route's own figures for the whole UTC day: since its start, less since its end.
    const [sinceStart, sinceEnd] = await Promise.all([service.spend(start.toISOString()), service.spend(end.toISOString())])
    const actualUsd = sinceStart && sinceEnd ? Math.max(0, sinceStart.actualUsd - sinceEnd.actualUsd) : null
    const videoSeconds = sinceStart?.videoSeconds != null && sinceEnd?.videoSeconds != null ? Math.max(0, sinceStart.videoSeconds - sinceEnd.videoSeconds) : null
    // The account is shared (other environments, traffic that never reaches this ledger): what it spent
    // beyond this ledger is context, never attributed here; this ledger recording MORE than the whole
    // account spent is this environment's own drift.
    const unexplainedUsd = actualUsd === null ? null : actualUsd - recordedUsd - lossesUsd
    const overRecordedUsd = actualUsd === null ? null : Math.max(0, recordedUsd + lossesUsd - actualUsd)
    const result: SpendDay = { day, recordedUsd, lossesUsd, actualUsd, videoSeconds, unexplainedUsd, overRecordedUsd, jobs, failedJobs, at: new Date().toISOString() }

    const percent = settings.video_route_policy.spendDriftAlertPercent ?? VIDEO_ROUTE_POLICY_DEFAULTS.spendDriftAlertPercent
    if (lossesUsd > 0) {
      await recordVideoRouteAlert({ key: `losses:${day}`, kind: "reconciliation", message: `${failedJobs} failed routed jobs on ${day} incurred ${lossesUsd.toFixed(2)} USD of supplier charges without a delivered result.` })
      console.error(`[ALERT] video route: on ${day} ${failedJobs} routed job(s) failed after the route billed them: ${lossesUsd.toFixed(2)} USD refunded to the people who ran them (known losses).`)
    }
    if (overRecordedUsd !== null && spendDrifted(recordedUsd + lossesUsd, overRecordedUsd, percent)) {
      await recordVideoRouteAlert({ key: `spend-drift:${day}`, kind: "reconciliation", message: `On ${day} this environment's ledger recorded ${(recordedUsd + lossesUsd).toFixed(2)} USD of verified bills, ${overRecordedUsd.toFixed(2)} USD more than the route's whole shared account reports it spent (threshold ${percent}%). The recorded bills may be wrong.` })
      console.error(
        `[ALERT] video route: on ${day} this environment's ledger recorded ${recordedUsd.toFixed(2)} USD on ${jobs} routed jobs and ${lossesUsd.toFixed(2)} USD on known losses, ` +
          `${overRecordedUsd.toFixed(2)} USD more than the route's whole account reports (${actualUsd!.toFixed(2)} USD, shared with other environments): the recorded bills may be wrong.`,
      )
    }
    await keepSpendDay(result)
    return result
  } catch (err) {
    console.error(`[video-route] the daily spend reconciliation failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

async function keepSpendDay(day: SpendDay): Promise<void> {
  await updateSettingsRow(videoRouteSpendDaysKey(), (raw) => {
    const mine = (Array.isArray(raw) ? (raw as SpendDay[]) : []).filter((d) => d.day !== day.day)
    return [day, ...mine].sort((a, b) => b.day.localeCompare(a.day)).slice(0, SPEND_DAYS_KEPT)
  })
}

/** This environment's kept reconciliation days, newest first (the row is this environment's own). */
export function spendDaysOf(raw: unknown): SpendDay[] {
  return Array.isArray(raw) ? (raw as SpendDay[]) : []
}

/** The "running" leases this process holds, so a shutdown can give them back (key → release). */
const heldRunningLeases = new Map<string, () => Promise<void>>()

/**
 * Runs `task` once per environment per period: every API instance's cron
 * fires, and the first to take the period's lease (Redis — one per
 * environment — keyed by the task and the period) runs it; the others skip.
 * A pass that outlasts its period must not overlap the next one: the pass
 * itself holds a second, "running" lease until it is done. A period that
 * finds it taken skips WITH a warning, and alerts once that pass has held it
 * for more than two periods (a pass that is stuck, or a process that died
 * holding it: its TTL frees it). A process shutting down gives its running
 * leases back ({@link releaseVideoRouteLeases}), so a deploy does not stall
 * the next pass for the lease's whole TTL. A Redis that cannot be reached
 * runs it here (the alerts are throttled and the day's write is idempotent).
 */
export async function runOncePerEnvironment(task: string, periodMs: number, fn: () => Promise<unknown>, now = Date.now()): Promise<boolean> {
  const periodStart = Math.floor(now / periodMs) * periodMs
  let release: (() => Promise<void>) | undefined
  const runningKey = `video-route:${getRuntimeEnv()}:${task}:running`
  try {
    const { acquireLease, releaseLease } = await import("../../lib/redis-lease.js")
    const { withRedisTimeout } = await import("../../lib/video-route-failures.js")
    const token = await withRedisTimeout(acquireLease(`video-route:${getRuntimeEnv()}:${task}:${periodStart}`, Math.min(periodMs, 24 * 3_600_000)))
    if (!token) return false
    const running = await withRedisTimeout(acquireLease(runningKey, RUNNING_LEASE_TTL_MS))
    if (!running) {
      await noteRunningLeaseHeld(task, runningKey, periodMs, now)
      return false
    }
    await keepRunningSince(runningKey, now)
    release = async () => {
      heldRunningLeases.delete(runningKey)
      try {
        await withRedisTimeout(releaseLease(runningKey, running))
      } catch {
        // Its TTL frees it.
      }
    }
    heldRunningLeases.set(runningKey, release)
  } catch (err) {
    console.warn(`[video-route] ${task}: the once-per-environment lease could not be taken; running here: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    await fn()
  } finally {
    await release?.()
  }
  return true
}

/** When the pass holding a running lease took it (a key beside the lease, with the same TTL). Best effort. */
async function keepRunningSince(runningKey: string, now: number): Promise<void> {
  try {
    const { redis } = await import("../../lib/queue.js")
    const { LEASE_KEY_PREFIX } = await import("../../lib/redis-lease.js")
    const { withRedisTimeout } = await import("../../lib/video-route-failures.js")
    await withRedisTimeout(redis.set(`${LEASE_KEY_PREFIX}${runningKey}:since`, String(now), "PX", RUNNING_LEASE_TTL_MS))
  } catch {
    // Without it a skip still warns; only the "held too long" alert needs it.
  }
}

/** A period skipped because the previous pass still holds its running lease: a warning, and an alert once it has held it past two periods. */
async function noteRunningLeaseHeld(task: string, runningKey: string, periodMs: number, now: number): Promise<void> {
  let since: number | null = null
  try {
    const { redis } = await import("../../lib/queue.js")
    const { LEASE_KEY_PREFIX } = await import("../../lib/redis-lease.js")
    const { withRedisTimeout } = await import("../../lib/video-route-failures.js")
    const raw = await withRedisTimeout(redis.get(`${LEASE_KEY_PREFIX}${runningKey}:since`))
    since = raw !== null && Number.isFinite(Number(raw)) ? Number(raw) : null
  } catch {
    since = null
  }
  const heldMs = since === null ? null : now - since
  console.warn(`[video-route] ${task}: this period's pass is skipped: the previous pass still holds its running lease${heldMs === null ? "" : ` (for ${Math.round(heldMs / 60_000)} min)`}.`)
  if (heldMs !== null && heldMs > 2 * periodMs) {
    const message = `The ${task} pass has been held by a pass that started ${Math.round(heldMs / 60_000)} minutes ago (more than two periods): its passes are being skipped until it ends or its lease expires.`
    console.error(`[ALERT] video route: ${message}`)
    await recordVideoRouteAlert({ key: `lease-held:${task}`, kind: "reconciliation", message }).catch(() => {})
  }
}

/**
 * Gives back every running lease this process holds (on shutdown: a pass cut
 * off by a deploy would otherwise hold the next passes off for the lease's
 * whole TTL). Bounded; never throws.
 */
export async function releaseVideoRouteLeases(timeoutMs = 2_000): Promise<void> {
  const releases = [...heldRunningLeases.values()]
  if (releases.length === 0) return
  await Promise.race([
    Promise.allSettled(releases.map((r) => r())),
    new Promise((resolve) => setTimeout(resolve, timeoutMs).unref?.()),
  ])
}

/** How long a pass may hold its "running" lease before a crashed one is taken to be gone. */
export const RUNNING_LEASE_TTL_MS = 2 * 3_600_000

/** The hourly balance check, once per environment. */
export function runBalanceCheckOnce(): Promise<boolean> {
  return runOncePerEnvironment("balances", 3_600_000, () => checkRouteBalances())
}

/**
 * The daily reminder of settlements still waiting for an admin's decision:
 * one alert a day while any is held, with how many and how long the oldest
 * has waited. Never throws.
 */
export async function remindHeldSettlements(now = new Date()): Promise<{ count: number; oldestAt: string | null } | null> {
  try {
    const held = await countHeldRouteSettles()
    if (held.count === 0) return held
    const days = held.oldestAt ? Math.floor((now.getTime() - Date.parse(held.oldestAt)) / 86_400_000) : 0
    const message = `${held.count} routed settlement(s) wait for a decision (a bill far above its quote, or a run the route never billed); the oldest has waited ${days} day(s). Decide them in Admin.`
    console.error(`[ALERT] video route: ${message}`)
    await recordVideoRouteAlert({ key: `holds-open:${now.toISOString().slice(0, 10)}`, kind: "anomaly", message })
    return held
  } catch (err) {
    console.error(`[video-route] the held-settlement reminder failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/**
 * The daily report of bills that arrived after their run was settled or
 * released (recorded, never charged), and of settlements left open under an
 * environment name no server answers to any more (a renamed environment: its
 * rows are never swept or listed by this one). Never throws.
 */
export async function reportLateBillsAndOrphans(now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10)
  try {
    const late = await countLateBills(new Date(now.getTime() - 86_400_000).toISOString())
    if (late > 0) {
      const message = `${late} routed run(s) had a bill arrive after they were settled or released in the last day. The differences are recorded as uncollected; nothing more was charged.`
      console.error(`[ALERT] video route: ${message}`)
      await recordVideoRouteAlert({ key: `late-bills:${day}`, kind: "reconciliation", message })
    }
  } catch (err) {
    console.error(`[video-route] the late-bill report failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    // Unpaid charges are enforced by the database for the environment a request NAMES. A server
    // that cannot name its own (its header is not sent) enforces nothing while the setting says it does.
    const settings = await getAppSettings()
    if (unpaidChargesEnforced(settings.video_route_policy) && !RUNTIME_ENV_NAMEABLE) {
      const message = `Unpaid charges are set to be enforced, but this server cannot name its environment ("${getRuntimeEnv()}") to the database, so nothing is enforced or collected. Give the environment a plain name, or switch enforcement off.`
      console.error(`[ALERT] video route: ${message}`)
      await recordVideoRouteAlert({ key: `enforcement-without-env:${day}`, kind: "reconciliation", message })
    }
  } catch (err) {
    console.error(`[video-route] the enforcement check failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    const stuck = await countStuckDeferredRepayments()
    if (stuck > 0) {
      const message = `${stuck} repayment(s) of unpaid routed charges could not be applied after repeated tries and are no longer retried. Each is recorded with the reason of its last try; the charges they would have repaid are still owed.`
      console.error(`[ALERT] video route: ${message}`)
      await recordVideoRouteAlert({ key: `stuck-repayments:${day}`, kind: "reconciliation", message })
    }
  } catch (err) {
    console.error(`[video-route] the stuck-repayment report failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    const quietSince = new Date(now.getTime() - ORPHAN_ENV_QUIET_DAYS * 86_400_000).toISOString()
    for (const other of await readOtherEnvOpenSettles()) {
      // An environment that still writes its ledger is alive and sweeps its own rows.
      if (await envWroteLedgerSince(other.env, quietSince)) continue
      const message = `${other.open} routed settlement(s) wait to be settled under the environment name "${other.env}", which has written nothing for ${ORPHAN_ENV_QUIET_DAYS} days. If that environment was renamed, no server sweeps them: settle them by hand.`
      // One standing alert per such environment (the same entry, refreshed), not a new one every day.
      console.warn(`[video-route] ${message}`)
      await recordVideoRouteAlert({ key: `orphan-env:${other.env}`, kind: "reconciliation", message })
    }
  } catch (err) {
    console.error(`[video-route] the orphan-environment check failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** How long an environment may write nothing to the ledger before its open settlements are reported as orphaned. */
export const ORPHAN_ENV_QUIET_DAYS = 3

/** The daily reconciliation, the held-settlement reminder and the late-bill / orphan report, once per environment. */
export function runReconciliationOnce(): Promise<boolean> {
  return runOncePerEnvironment("reconcile", 86_400_000, async () => {
    await reconcileRouteSpend()
    await remindHeldSettlements()
    await reportLateBillsAndOrphans()
  })
}

/** Test seam. */
export function _resetBalanceAlertsForTests(): void {
  lastBalanceAlert.clear()
}

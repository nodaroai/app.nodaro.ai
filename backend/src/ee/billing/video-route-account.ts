/**
 * The daily reconciliation of the route's WHOLE account (Cloud only;
 * docs/design/alternate-routes.md, "Daily reconciliation"). Alerts and reports
 * only: nothing here changes a price, a route or a charge, and nothing throws
 * to its caller.
 *
 * The route's prepaid account is shared. Every environment on this database
 * (staging and production share it) spends from it, and so do alternate-route
 * jobs that write no ledger (the consult made while no routing policy is
 * saved). So the one comparison that can find spend nothing here recorded is
 * the account's spend against EVERYTHING recorded, on one day basis:
 *   - every environment's ledger: each verified task bill, on the day the route
 *     billed it (lib/video-route-ledger.ts `routeBillingAtOf`: the route's own
 *     completion time, else the time the task was first read done), never the
 *     day the bill reached the ledger;
 *   - sends delivered with no bill yet, at the route's own estimate (pending);
 *   - alternate-route jobs with no routing decision: their recorded
 *     `provider_cost`, on the day they completed. That figure is the route's
 *     reported cost when it gave one, else the plan's estimate, and such a job
 *     that ended with no result records none: an approximation, which the
 *     tolerance has to absorb;
 * against what the route's `spend()` reports for each whole UTC day (asked for
 * the day just ended; an earlier day keeps the figure measured when it was the
 * day just ended, since how far back the route answers is its own). Past the
 * tolerance (the admin's `spendDriftAlertPercent` of what was recorded, never
 * less than {@link MIDNIGHT_STRADDLE_ALLOWANCE_USD}), the account spending MORE
 * than everything recorded is an alert (paid tasks nothing here recorded may
 * exist), and so is what was recorded coming to MORE than the account spent
 * (recorded bills may be wrong).
 *
 * A bill that arrives late moves a day already reconciled, so each pass
 * recomputes the last {@link ACCOUNT_DAYS_TRAILING} days (the late-bill watch
 * and the settlement's wait before it), and alerts a day again only when its
 * difference grew past the tolerance since it was last alerted.
 *
 * Once per ACCOUNT, not per environment: the pass claims its day in a settings
 * row no environment owns ({@link ACCOUNT_ROW_KEY}), by a compare-and-set. The
 * first environment WITH A ROUTING POLICY SAVED whose daily pass reaches it
 * takes the day; any other (another environment, or another server of the same
 * one) finds it claimed and skips. A claim not marked done within
 * {@link ACCOUNT_CLAIM_TAKEOVER_MS} (a pass that died) may be taken by a later
 * pass. Its alerts are kept in the Admin of the environment that ran it, and in
 * that server's log.
 */
import { recordVideoRouteAlert } from "./video-route-alerts.js"
import { supabase } from "../../lib/supabase.js"
import { getAppSettings, settingsReadFailed } from "../../lib/app-settings.js"
import { getRuntimeEnv } from "../../lib/runtime-env.js"
import { getPluginServices } from "../../lib/private-plugins/services-registry.js"
import { VIDEO_ROUTE_POLICY_DEFAULTS } from "../../lib/video-route-policy.js"
import { readSettingsRowValue, updateSettingsRow } from "../../lib/video-route-policy-store.js"
import { routeBillingAtOf, verifiedTaskUsd } from "../../lib/video-route-ledger.js"
import { ALTERNATE_ROUTE_JOB_TYPES, ALTERNATE_ROUTE_PROVIDER_KIND } from "../../lib/alternate-route-request.js"
import { VIDEO_ROUTE_STAMP_KEY } from "../../lib/video-route-decision.js"
import { LATE_BILL_WATCH_DAYS } from "./video-route-receipt.js"

/** A run that straddles midnight bills on one side and is recorded on the other: this much of a difference is not drift. */
export const MIDNIGHT_STRADDLE_ALLOWANCE_USD = 0.5
/** The settings row the account's days (and the day's claim) are kept in: shared by every environment, owned by none. */
export const ACCOUNT_ROW_KEY = "video_route_account_days"
/** The days each pass recomputes: the late-bill watch, and the two days a settlement waits before it. */
export const ACCOUNT_DAYS_TRAILING = LATE_BILL_WATCH_DAYS + 2
/** A claim older than this that is not marked done belongs to a pass that died: a later pass may take it. */
export const ACCOUNT_CLAIM_TAKEOVER_MS = 2 * 3_600_000
/** A task read done this long after it finished still lands on its own day (a recovery after a restart). */
const READ_DONE_LAG_MS = 2 * 86_400_000
const ACCOUNT_DAYS_KEPT = 30
const DAY_MS = 86_400_000
const PAGE = 1000

/** One task row of the ledger, placed on the day the route billed it. */
export interface BilledTask {
  readonly id: number
  readonly jobId: string
  readonly env: string
  readonly billedUsd: number | null
  readonly estimatedUsd: number | null
  readonly outcome: string | null
  readonly ownLoss: boolean
  /** When the route billed it (`routeBillingAtOf`). */
  readonly at: string
}

const numberOf = (v: unknown): number | null => {
  const n = typeof v === "string" && v !== "" ? Number(v) : v
  return typeof n === "number" && Number.isFinite(n) ? n : null
}

/**
 * The ledger's task rows whose bill belongs to [start, end) on the route's
 * books ({@link routeBillingAtOf}) — one environment's, or every
 * environment's when `env` is not given. Rows written from
 * {@link READ_DONE_LAG_MS} before the window on, and rows whose bill was
 * recorded in it, are read; each is then placed on its own day. Every page is
 * read. Throws on a database error.
 */
export async function ledgerTasksBilledBetween(start: Date, end: Date, env?: string): Promise<BilledTask[]> {
  type Row = { id: number; job_id: string; env: string; billed_usd: unknown; estimated_usd?: unknown; outcome?: unknown; detail?: unknown; created_at?: unknown }
  const byId = new Map<number, Row>()
  const reads: Array<{ column: string; from: string; to?: string }> = [
    { column: "created_at", from: new Date(start.getTime() - READ_DONE_LAG_MS).toISOString() },
    { column: "detail->>billedAt", from: start.toISOString(), to: end.toISOString() },
  ]
  for (const read of reads) {
    for (let from = 0; ; from += PAGE) {
      let q = (supabase.from("video_route_ledger" as "assets") as unknown as { select(c: string): any })
        .select("id, job_id, env, billed_usd, estimated_usd, outcome, detail, created_at")
        .eq("kind", "task")
        .gte(read.column, read.from)
      if (read.to) q = q.lt(read.column, read.to)
      if (env !== undefined) q = q.eq("env", env)
      const { data, error } = await q.order("id", { ascending: true }).range(from, from + PAGE - 1)
      if (error) throw new Error(error.message)
      const page = (data ?? []) as Row[]
      for (const r of page) byId.set(r.id, r)
      if (page.length < PAGE) break
    }
  }
  const out: BilledTask[] = []
  for (const r of byId.values()) {
    const at = routeBillingAtOf(r)
    const ms = at ? Date.parse(at) : NaN
    if (!at || !(ms >= start.getTime() && ms < end.getTime())) continue
    out.push({
      id: r.id, jobId: r.job_id, env: r.env, billedUsd: verifiedTaskUsd(r), estimatedUsd: numberOf(r.estimated_usd),
      outcome: typeof r.outcome === "string" ? r.outcome : null, ownLoss: (r.detail as { ownLoss?: unknown } | null)?.ownLoss === true, at,
    })
  }
  return out
}

/**
 * Alternate-route jobs with no routing decision (they write no ledger) that
 * completed in [start, end), with the cost each recorded. Read through the
 * job-type index: `ALTERNATE_ROUTE_JOB_TYPES` is every platform lane that
 * sends a video model to the route, so no job the route holds is of another
 * type. Throws on a database error.
 */
async function unroutedRouteJobsBetween(start: Date, end: Date): Promise<Array<{ completedAt: string; costUsd: number | null }>> {
  const out: Array<{ completedAt: string; costUsd: number | null }> = []
  for (let from = 0; ; from += PAGE) {
    // trash-read: money that was spent, whatever became of the job since.
    const { data, error } = await supabase.from("jobs")
      .select(`id, provider_cost, completed_at, stamp:input_data->${VIDEO_ROUTE_STAMP_KEY}, run:metadata->videoRouteRun`)
      .in("job_type", [...ALTERNATE_ROUTE_JOB_TYPES])
      .eq("provider_kind", ALTERNATE_ROUTE_PROVIDER_KIND)
      .gte("completed_at", start.toISOString())
      .lt("completed_at", end.toISOString())
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as Array<{ provider_cost?: unknown; completed_at?: unknown; stamp?: unknown; run?: unknown }>
    for (const j of page) {
      // A job with a routing decision (or a routed run) is on the ledger already.
      if ((j.stamp !== null && j.stamp !== undefined) || (j.run !== null && j.run !== undefined)) continue
      if (typeof j.completed_at !== "string") continue
      out.push({ completedAt: j.completed_at, costUsd: numberOf(j.provider_cost) })
    }
    if (page.length < PAGE) break
  }
  return out
}

/** One UTC day of the account, as the pass found it. */
export interface AccountDay {
  readonly day: string
  /** What the route reports its account spent that whole UTC day; null when it could not be read. */
  readonly actualUsd: number | null
  /** Every environment's verified bills the route billed that day. */
  readonly ledgerUsd: number
  /** The same, per environment. */
  readonly byEnv: Readonly<Record<string, number>>
  /** Delivered sends of that day with no bill yet, at the route's estimate. */
  readonly pendingUsd: number
  /** Delivered sends of that day with no bill and no estimate (counted, not priced). */
  readonly unpricedSends: number
  /** Alternate-route jobs with no routing decision that completed that day: their recorded cost. */
  readonly unroutedUsd: number
  readonly unroutedJobs: number
  /** What the account spent beyond everything recorded (0 when nothing; null with no account figure). */
  readonly unrecordedUsd: number | null
  /** What was recorded beyond what the account spent (0 when nothing; null with no account figure). */
  readonly overRecordedUsd: number | null
  /** How far apart the two may be and not alert. */
  readonly toleranceUsd: number
  /** The differences last alerted for this day (a day is alerted again only when its difference grows past the tolerance). */
  readonly alerted?: { readonly unrecordedUsd?: number; readonly overRecordedUsd?: number }
  readonly env: string
  readonly at: string
}

interface AccountRow {
  readonly claim?: { readonly day: string; readonly env: string; readonly at: string; readonly done?: boolean }
  readonly days?: readonly AccountDay[]
}

function accountRowOf(raw: unknown): AccountRow {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as AccountRow) : {}
}

/** The account's kept days, newest first. */
export function accountDaysOf(raw: unknown): AccountDay[] {
  const days = accountRowOf(raw).days
  return Array.isArray(days) ? [...days] : []
}

/** The account's kept days, read fresh. Throws on a database error. */
export async function readAccountDays(): Promise<AccountDay[]> {
  return accountDaysOf(await readSettingsRowValue(ACCOUNT_ROW_KEY))
}

const round = (usd: number): number => Math.round(usd * 1e6) / 1e6

/**
 * Takes the pass of `passDay` for this environment ({@link ACCOUNT_ROW_KEY}):
 * true when THIS call took it; false when another pass holds it (or finished
 * it). Throws on a database error.
 */
async function claimAccountPass(passDay: string, now: number): Promise<boolean> {
  const taken = await updateSettingsRow(ACCOUNT_ROW_KEY, (raw) => {
    const row = accountRowOf(raw)
    const c = row.claim
    if (c && c.day === passDay && (c.done === true || now - Date.parse(c.at) < ACCOUNT_CLAIM_TAKEOVER_MS)) return undefined
    return { ...row, claim: { day: passDay, env: getRuntimeEnv(), at: new Date(now).toISOString() } }
  })
  return taken !== undefined
}

/**
 * The account's pass for the day before `now` (see the module doc): recomputes
 * the last {@link ACCOUNT_DAYS_TRAILING} UTC days, alerts, and keeps them.
 * Null when it is not this pass's to run: no route service that reports its
 * spend, no routing policy saved in this environment, or the day already
 * claimed. Never throws.
 */
export async function reconcileRouteAccount(now = new Date()): Promise<AccountDay[] | null> {
  try {
    const service = getPluginServices().alternateRoutes
    if (typeof service?.spend !== "function") return null
    const settings = await getAppSettings()
    if (settingsReadFailed(settings) || !settings.video_route_policy) return null
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const passDay = new Date(todayStart - DAY_MS).toISOString().slice(0, 10)
    if (!(await claimAccountPass(passDay, now.getTime()))) return null

    const windowStart = new Date(todayStart - ACCOUNT_DAYS_TRAILING * DAY_MS)
    const windowEnd = new Date(todayStart)
    const [tasks, unrouted] = await Promise.all([ledgerTasksBilledBetween(windowStart, windowEnd), unroutedRouteJobsBetween(windowStart, windowEnd)])
    // The route counts whole UTC days, and how far back it answers is its own (a day older than that
    // reads as nothing spent). So only the pass's own day is asked for — since its midnight, less since
    // today's — and each earlier day keeps the figure measured when it was the pass's day.
    const [sinceStart, sinceEnd] = await Promise.all([new Date(todayStart - DAY_MS), new Date(todayStart)].map((d) => service.spend!(d.toISOString()).catch(() => null)))
    const passDayActual = sinceStart && sinceEnd ? round(Math.max(0, sinceStart.actualUsd - sinceEnd.actualUsd)) : null
    const percent = settings.video_route_policy.spendDriftAlertPercent ?? VIDEO_ROUTE_POLICY_DEFAULTS.spendDriftAlertPercent
    const kept = new Map(accountDaysOf(await readSettingsRowValue(ACCOUNT_ROW_KEY)).map((d) => [d.day, d]))
    const env = getRuntimeEnv()
    const at = new Date().toISOString()
    const days: AccountDay[] = []
    for (let i = 1; i <= ACCOUNT_DAYS_TRAILING; i++) {
      const start = todayStart - i * DAY_MS
      const end = start + DAY_MS
      const day = new Date(start).toISOString().slice(0, 10)
      const inDay = (iso: string): boolean => {
        const ms = Date.parse(iso)
        return ms >= start && ms < end
      }
      let ledgerUsd = 0
      let pendingUsd = 0
      let unpricedSends = 0
      const byEnv: Record<string, number> = {}
      for (const t of tasks) {
        if (!inDay(t.at)) continue
        if (t.billedUsd !== null) {
          ledgerUsd += t.billedUsd
          byEnv[t.env] = round((byEnv[t.env] ?? 0) + t.billedUsd)
        } else if (t.outcome === null || t.outcome === "done") {
          // Delivered with no bill yet: the route has billed it (done means charged), at its estimate.
          if (t.estimatedUsd !== null) pendingUsd += t.estimatedUsd
          else unpricedSends++
        }
      }
      let unroutedUsd = 0
      let unroutedJobs = 0
      for (const j of unrouted) {
        if (!inDay(j.completedAt)) continue
        unroutedJobs++
        unroutedUsd += j.costUsd ?? 0
      }
      const actualUsd = i === 1 ? passDayActual : (kept.get(day)?.actualUsd ?? null)
      const recordedUsd = ledgerUsd + unroutedUsd
      const toleranceUsd = round(Math.max((recordedUsd + pendingUsd) * (percent / 100), MIDNIGHT_STRADDLE_ALLOWANCE_USD))
      // Spend nothing recorded: what the account spent beyond every bill, every send still to be billed and every unrouted job.
      const unrecordedUsd = actualUsd === null ? null : round(Math.max(0, actualUsd - recordedUsd - pendingUsd))
      // Recorded beyond the account: the bills recorded (an estimate of a send still to be billed is not one).
      const overRecordedUsd = actualUsd === null ? null : round(Math.max(0, recordedUsd - actualUsd))
      const before = kept.get(day)?.alerted ?? {}
      const alerted: { unrecordedUsd?: number; overRecordedUsd?: number } = { ...before }
      const record = { day, actualUsd, ledgerUsd: round(ledgerUsd), byEnv, pendingUsd: round(pendingUsd), unpricedSends, unroutedUsd: round(unroutedUsd), unroutedJobs, unrecordedUsd, overRecordedUsd, toleranceUsd }
      if (unrecordedUsd !== null && unrecordedUsd > toleranceUsd && (before.unrecordedUsd === undefined || unrecordedUsd > before.unrecordedUsd + toleranceUsd)) {
        const message = `On ${day} the route's account spent ${actualUsd!.toFixed(2)} USD, ${unrecordedUsd.toFixed(2)} USD more than everything recorded for that day across every environment (${round(ledgerUsd).toFixed(2)} USD of verified bills, ${round(pendingUsd).toFixed(2)} USD of sends still to be billed${unpricedSends > 0 ? ` and ${unpricedSends} with no estimate` : ""}, ${round(unroutedUsd).toFixed(2)} USD on ${unroutedJobs} unrouted alternate-route job(s); tolerance ${toleranceUsd.toFixed(2)} USD). Paid tasks that nothing here recorded may exist: check the route's own task list for that day.`
        console.error(`[ALERT] video route: ${message}`)
        await recordVideoRouteAlert({ key: `account-unrecorded:${day}`, kind: "reconciliation", message })
        alerted.unrecordedUsd = unrecordedUsd
      }
      if (overRecordedUsd !== null && overRecordedUsd > toleranceUsd && (before.overRecordedUsd === undefined || overRecordedUsd > before.overRecordedUsd + toleranceUsd)) {
        const message = `On ${day} everything recorded across every environment (${round(ledgerUsd).toFixed(2)} USD of verified bills and ${round(unroutedUsd).toFixed(2)} USD on unrouted alternate-route jobs) comes to ${overRecordedUsd.toFixed(2)} USD more than the route's account reports it spent (${actualUsd!.toFixed(2)} USD; tolerance ${toleranceUsd.toFixed(2)} USD). The recorded bills may be wrong.`
        console.error(`[ALERT] video route: ${message}`)
        await recordVideoRouteAlert({ key: `account-over-recorded:${day}`, kind: "reconciliation", message })
        alerted.overRecordedUsd = overRecordedUsd
      }
      days.push({ ...record, ...(Object.keys(alerted).length > 0 ? { alerted } : {}), env, at })
    }
    await updateSettingsRow(ACCOUNT_ROW_KEY, (raw) => {
      const row = accountRowOf(raw)
      const fresh = new Set(days.map((d) => d.day))
      const merged = [...days, ...accountDaysOf(raw).filter((d) => !fresh.has(d.day))].sort((a, b) => b.day.localeCompare(a.day)).slice(0, ACCOUNT_DAYS_KEPT)
      // The claim is marked done only when it is still this pass's (one taken over meanwhile is left to its taker).
      const mine = row.claim?.day === passDay && row.claim.env === env
      return { ...row, ...(mine ? { claim: { ...row.claim!, done: true } } : {}), days: merged }
    })
    return days
  } catch (err) {
    console.error(`[video-route] the daily account reconciliation failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

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
 * against what the route's `spend()` reports for each whole UTC day. The route
 * is asked for a day's spend only while the day is recent
 * ({@link ACCOUNT_SPEND_REACH_DAYS}: how far back it answers is its own, and a
 * day older than that reads as nothing spent); a day it could not be read for
 * stays `pending` and is asked again on the next passes, and one still unread
 * when it leaves that reach is `unmeasured`, alerted once and never compared.
 * The policy's known other spend on the account (`accountOtherSpendUsdPerDay`,
 * default 0: another user of the same account, set by the owner from what they
 * know) is taken off the account's spend first, and a difference that the
 * neighbouring day offsets within one run's worth is a midnight straddle
 * ({@link offsetMidnightStraddles}). Past the tolerance (the admin's
 * `spendDriftAlertPercent` of what was recorded, never less than
 * {@link MIDNIGHT_STRADDLE_ALLOWANCE_USD}), the account spending MORE than
 * everything recorded is an alert (paid tasks nothing here recorded may exist),
 * and so is what was recorded coming to MORE than the account spent (recorded
 * bills may be wrong) — each only when a LATER pass day still sees it, so a
 * late bill or the next day's figure gets its chance to explain it first.
 *
 * A bill that arrives late moves a day already reconciled, so each pass
 * recomputes the last {@link ACCOUNT_DAYS_TRAILING} days (the late-bill watch
 * and the settlement's wait before it), and alerts a day again only when its
 * difference grew past the tolerance since it was last alerted.
 *
 * Once per ACCOUNT, not per environment, tried every hour: the pass claims its
 * day in a settings row no environment owns ({@link ACCOUNT_ROW_KEY}), by a
 * compare-and-set. The first environment WITH A ROUTING POLICY SAVED whose
 * hourly pass reaches it takes the day; any other (another environment, or
 * another server of the same one) finds it claimed and skips. The day is marked
 * done only once its spend was read; a pass that fails (alerted) or could not
 * read it gives its claim back, so a later hour tries again, and a claim not
 * given back or done within {@link ACCOUNT_CLAIM_TAKEOVER_MS} (a pass that died)
 * may be taken. Its alerts are kept in the Admin of the environment that ran
 * it, and in that server's log.
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
  /**
   * `measured`: the account's spend for the day was read. `pending`: it could
   * not be read yet; it is asked again on the next passes while the route still
   * reports that day ({@link ACCOUNT_SPEND_REACH_DAYS}). `unmeasured`: it could
   * not be read while the route reported that day (alerted once); never compared.
   */
  readonly status: "measured" | "pending" | "unmeasured"
  /** What the route reports its account spent that whole UTC day; null when it was not read. */
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
  /** The policy's known other spend on the account (`accountOtherSpendUsdPerDay`), taken off the account's spend. */
  readonly otherSpendUsd: number
  /** The part of the day's difference offset by a neighbouring day's opposite one (runs that straddle midnight). */
  readonly straddleUsd: number
  /** What the account spent beyond everything recorded, after the allowance and the straddle (null with no account figure). */
  readonly unrecordedUsd: number | null
  /** What was recorded beyond what the account spent, after the straddle (null with no account figure). */
  readonly overRecordedUsd: number | null
  /** How far apart the two may be and not alert. */
  readonly toleranceUsd: number
  /** The pass day each difference was first seen past the tolerance: it is alerted only when a LATER pass still sees it. */
  readonly unrecordedSince?: string
  readonly overRecordedSince?: string
  /** The differences last alerted for this day (alerted again only when one grows past the tolerance), and whether its missing figure was. */
  readonly alerted?: { readonly unrecordedUsd?: number; readonly overRecordedUsd?: number; readonly unmeasured?: boolean }
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

/** The account's kept days, read fresh (Admin → Video route). Throws on a database error. */
export async function readAccountDays(): Promise<AccountDay[]> {
  return accountDaysOf(await readSettingsRowValue(ACCOUNT_ROW_KEY))
}

const round = (usd: number): number => Math.round(usd * 1e6) / 1e6

/**
 * How many days back the route is asked for a day's spend: the day just ended
 * and the one before. How far back it really answers is its own (a day older
 * than that reads as nothing spent, never as an error), so a day is asked for
 * only while it is this recent; one never read by then is `unmeasured`.
 */
export const ACCOUNT_SPEND_REACH_DAYS = 2

/**
 * Runs that straddle midnight: the route bills a run on one side of midnight and
 * this ledger places it on the other, so the account seems to spend more than
 * was recorded on one day and less on its neighbour. For each pair of
 * neighbouring measured days (oldest first), the part of one day's unrecorded
 * spend that the other day's over-recorded excess offsets — at most one clip's
 * worth (the larger of the two days' largest single run, and never less than
 * {@link MIDNIGHT_STRADDLE_ALLOWANCE_USD}) — is a straddle, taken off both.
 * Pure.
 */
export function offsetMidnightStraddles(days: ReadonlyArray<{ readonly unrecordedUsd: number | null; readonly overRecordedUsd: number | null; readonly clipUsd: number }>): Array<{ unrecordedUsd: number | null; overRecordedUsd: number | null; straddleUsd: number }> {
  const out = days.map((d) => ({ unrecordedUsd: d.unrecordedUsd, overRecordedUsd: d.overRecordedUsd, straddleUsd: 0 }))
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i]!
    const b = out[i + 1]!
    if (a.unrecordedUsd === null || a.overRecordedUsd === null || b.unrecordedUsd === null || b.overRecordedUsd === null) continue
    let clip = Math.max(days[i]!.clipUsd, days[i + 1]!.clipUsd, MIDNIGHT_STRADDLE_ALLOWANCE_USD)
    // Spent on the earlier day, recorded on the later one; then the other way round.
    for (const [short, long] of [[a, b], [b, a]] as const) {
      const offset = Math.min(short.unrecordedUsd!, long.overRecordedUsd!, clip)
      if (offset <= 0) continue
      short.unrecordedUsd = round(short.unrecordedUsd! - offset)
      long.overRecordedUsd = round(long.overRecordedUsd! - offset)
      short.straddleUsd = round(short.straddleUsd + offset)
      long.straddleUsd = round(long.straddleUsd + offset)
      clip -= offset
    }
  }
  return out
}

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

/** Gives back this pass's claim (it did not finish), so the next pass takes the day again. Best effort. */
async function releaseAccountPass(passDay: string, at: string): Promise<void> {
  try {
    await updateSettingsRow(ACCOUNT_ROW_KEY, (raw) => {
      const row = accountRowOf(raw)
      if (row.claim?.day !== passDay || row.claim.env !== getRuntimeEnv() || row.claim.at !== at || row.claim.done === true) return undefined
      const { claim: _released, ...rest } = row
      return rest
    })
  } catch {
    // Its claim then lapses after ACCOUNT_CLAIM_TAKEOVER_MS.
  }
}

/** An alert, kept in Admin; one that cannot be kept is logged and never stops the pass. */
async function alertKept(alert: { key: string; message: string }): Promise<void> {
  try {
    await recordVideoRouteAlert({ ...alert, kind: "reconciliation" })
  } catch (err) {
    console.error(`[video-route] the account alert ${alert.key} could not be kept: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** The account's spend over one whole UTC day [start, start + 1 day), or null when it could not be read. */
async function daySpend(spend: NonNullable<ReturnType<typeof getPluginServices>["alternateRoutes"]>["spend"], start: number): Promise<number | null> {
  if (!spend) return null
  const [since, after] = await Promise.all([start, start + DAY_MS].map((ms) => spend(new Date(ms).toISOString()).catch(() => null)))
  return since && after ? round(Math.max(0, since.actualUsd - after.actualUsd)) : null
}

/**
 * The account's pass for the day before `now` (see the module doc). Run every
 * hour: the first pass of a day claims it; a pass that fails, or that could not
 * read the account's spend for its day, gives its claim back (with an alert on
 * a failure), so a later pass of the same day tries again, and a day is marked
 * done only once its spend was read. Each pass recomputes the last
 * {@link ACCOUNT_DAYS_TRAILING} UTC days, asks the route again for each day
 * still `pending` within {@link ACCOUNT_SPEND_REACH_DAYS}, offsets midnight
 * straddles ({@link offsetMidnightStraddles}), and alerts a difference only
 * when a LATER pass day still sees it past the tolerance (a late bill, or the
 * next day's figure, gets its chance to explain it first). Null when it is not
 * this pass's to run: no route service that reports its spend, no routing
 * policy saved in this environment, or the day already claimed or done. Never
 * throws.
 */
export async function reconcileRouteAccount(now = new Date()): Promise<AccountDay[] | null> {
  let claimed: { passDay: string; at: string } | null = null
  try {
    const service = getPluginServices().alternateRoutes
    if (typeof service?.spend !== "function") return null
    const settings = await getAppSettings()
    if (settingsReadFailed(settings) || !settings.video_route_policy) return null
    const policy = settings.video_route_policy
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const passDay = new Date(todayStart - DAY_MS).toISOString().slice(0, 10)
    if (!(await claimAccountPass(passDay, now.getTime()))) return null
    const claimAt = new Date(now.getTime()).toISOString()
    claimed = { passDay, at: claimAt }

    const windowStart = new Date(todayStart - ACCOUNT_DAYS_TRAILING * DAY_MS)
    const windowEnd = new Date(todayStart)
    const [tasks, unrouted] = await Promise.all([ledgerTasksBilledBetween(windowStart, windowEnd), unroutedRouteJobsBetween(windowStart, windowEnd)])
    const percent = policy.spendDriftAlertPercent ?? VIDEO_ROUTE_POLICY_DEFAULTS.spendDriftAlertPercent
    const otherSpendUsd = typeof policy.accountOtherSpendUsdPerDay === "number" && policy.accountOtherSpendUsdPerDay > 0 ? policy.accountOtherSpendUsdPerDay : 0
    const kept = new Map(accountDaysOf(await readSettingsRowValue(ACCOUNT_ROW_KEY)).map((d) => [d.day, d]))
    const env = getRuntimeEnv()
    const at = new Date().toISOString()

    // The days, oldest first, with what each recorded and the account's figure for it.
    type Raw = Omit<AccountDay, "status" | "straddleUsd" | "unrecordedUsd" | "overRecordedUsd" | "unrecordedSince" | "overRecordedSince" | "alerted" | "env" | "at"> & { status: AccountDay["status"]; clipUsd: number; recordedUsd: number; reach: number }
    const raw: Raw[] = []
    for (let i = ACCOUNT_DAYS_TRAILING; i >= 1; i--) {
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
      let clipUsd = 0
      const byEnv: Record<string, number> = {}
      for (const t of tasks) {
        if (!inDay(t.at)) continue
        if (t.billedUsd !== null) {
          ledgerUsd += t.billedUsd
          byEnv[t.env] = round((byEnv[t.env] ?? 0) + t.billedUsd)
          clipUsd = Math.max(clipUsd, t.billedUsd)
        } else if (t.outcome === null || t.outcome === "done") {
          // Delivered with no bill yet: the route has billed it (done means charged), at its estimate.
          if (t.estimatedUsd !== null) {
            pendingUsd += t.estimatedUsd
            clipUsd = Math.max(clipUsd, t.estimatedUsd)
          } else unpricedSends++
        }
      }
      let unroutedUsd = 0
      let unroutedJobs = 0
      for (const j of unrouted) {
        if (!inDay(j.completedAt)) continue
        unroutedJobs++
        unroutedUsd += j.costUsd ?? 0
        clipUsd = Math.max(clipUsd, j.costUsd ?? 0)
      }
      const before = kept.get(day)
      // The account's figure: kept once read; asked for again while the day is still within reach.
      let actualUsd = before?.status === "measured" && typeof before.actualUsd === "number" ? before.actualUsd : null
      if (actualUsd === null && i <= ACCOUNT_SPEND_REACH_DAYS) {
        actualUsd = await daySpend(service.spend, start)
        if (actualUsd === null) console.warn(`[video-route] the route's account spend for ${day} could not be read; it is asked again on the next pass.`)
      }
      const status: AccountDay["status"] = actualUsd !== null ? "measured" : i <= ACCOUNT_SPEND_REACH_DAYS ? "pending" : "unmeasured"
      const recordedUsd = ledgerUsd + unroutedUsd
      raw.push({
        day, status, actualUsd, ledgerUsd: round(ledgerUsd), byEnv, pendingUsd: round(pendingUsd), unpricedSends, unroutedUsd: round(unroutedUsd), unroutedJobs, otherSpendUsd,
        toleranceUsd: round(Math.max((recordedUsd + pendingUsd) * (percent / 100), MIDNIGHT_STRADDLE_ALLOWANCE_USD)), clipUsd: round(clipUsd), recordedUsd, reach: i,
      })
    }
    const offset = offsetMidnightStraddles(raw.map((d) => ({
      // Spend nothing recorded: what the account spent beyond every bill, every send still to be billed,
      // every unrouted job and the known other spend.
      unrecordedUsd: d.actualUsd === null ? null : round(Math.max(0, d.actualUsd - d.recordedUsd - d.pendingUsd - otherSpendUsd)),
      // Recorded beyond the account: the bills recorded (an estimate of a send still to be billed is not one).
      overRecordedUsd: d.actualUsd === null ? null : round(Math.max(0, d.recordedUsd - d.actualUsd)),
      clipUsd: d.clipUsd,
    })))

    const days: AccountDay[] = []
    for (let k = 0; k < raw.length; k++) {
      const { clipUsd: _clip, recordedUsd: _recorded, reach: _reach, ...d } = raw[k]!
      const { unrecordedUsd, overRecordedUsd, straddleUsd } = offset[k]!
      const before = kept.get(d.day)
      const alerted: { unrecordedUsd?: number; overRecordedUsd?: number; unmeasured?: boolean } = { ...(before?.alerted ?? {}) }
      // A difference past the tolerance is first only noted (the pass day it was seen); a later pass day
      // that still sees it alerts, and alerts again only when it grows past the tolerance.
      const since = (gap: number | null, seen: string | undefined): string | undefined => (gap !== null && gap > d.toleranceUsd ? (seen ?? passDay) : undefined)
      const unrecordedSince = since(unrecordedUsd, before?.unrecordedSince)
      const overRecordedSince = since(overRecordedUsd, before?.overRecordedSince)
      if (unrecordedUsd !== null && unrecordedSince !== undefined && unrecordedSince < passDay && (alerted.unrecordedUsd === undefined || unrecordedUsd > alerted.unrecordedUsd + d.toleranceUsd)) {
        const message = `On ${d.day} the route's account spent ${d.actualUsd!.toFixed(2)} USD, ${unrecordedUsd.toFixed(2)} USD more than everything recorded for that day across every environment (${d.ledgerUsd.toFixed(2)} USD of verified bills, ${d.pendingUsd.toFixed(2)} USD of sends still to be billed${d.unpricedSends > 0 ? ` and ${d.unpricedSends} with no estimate` : ""}, ${d.unroutedUsd.toFixed(2)} USD on ${d.unroutedJobs} unrouted alternate-route job(s), ${otherSpendUsd.toFixed(2)} USD of known other spend${straddleUsd > 0 ? `, ${straddleUsd.toFixed(2)} USD offset by a neighbouring day` : ""}; tolerance ${d.toleranceUsd.toFixed(2)} USD), on two checks in a row. Paid tasks that nothing here recorded may exist: check the route's own task list for that day.`
        console.error(`[ALERT] video route: ${message}`)
        await alertKept({ key: `account-unrecorded:${d.day}`, message })
        alerted.unrecordedUsd = unrecordedUsd
      }
      if (overRecordedUsd !== null && overRecordedSince !== undefined && overRecordedSince < passDay && (alerted.overRecordedUsd === undefined || overRecordedUsd > alerted.overRecordedUsd + d.toleranceUsd)) {
        const message = `On ${d.day} everything recorded across every environment (${d.ledgerUsd.toFixed(2)} USD of verified bills and ${d.unroutedUsd.toFixed(2)} USD on unrouted alternate-route jobs) comes to ${overRecordedUsd.toFixed(2)} USD more than the route's account reports it spent (${d.actualUsd!.toFixed(2)} USD${straddleUsd > 0 ? `; ${straddleUsd.toFixed(2)} USD offset by a neighbouring day` : ""}; tolerance ${d.toleranceUsd.toFixed(2)} USD), on two checks in a row. The recorded bills may be wrong.`
        console.error(`[ALERT] video route: ${message}`)
        await alertKept({ key: `account-over-recorded:${d.day}`, message })
        alerted.overRecordedUsd = overRecordedUsd
      }
      // A day that was asked for and stayed unread until the route no longer reports it (a day never asked for, before the first pass, is not).
      if (d.status === "unmeasured" && alerted.unmeasured !== true && before?.status === "pending") {
        const message = `The route's account spend for ${d.day} could not be read while the route still reported that day: the day is not compared with what was recorded (${d.ledgerUsd.toFixed(2)} USD of verified bills across every environment).`
        console.error(`[ALERT] video route: ${message}`)
        await alertKept({ key: `account-unmeasured:${d.day}`, message })
        alerted.unmeasured = true
      }
      days.unshift({
        ...d, straddleUsd, unrecordedUsd, overRecordedUsd,
        ...(unrecordedSince ? { unrecordedSince } : {}), ...(overRecordedSince ? { overRecordedSince } : {}),
        ...(Object.keys(alerted).length > 0 ? { alerted } : {}), env, at,
      })
    }
    // The pass is done only once its own day's spend was read; otherwise its claim goes back and a later pass reads it again.
    const done = days[0]?.status === "measured"
    await updateSettingsRow(ACCOUNT_ROW_KEY, (rawRow) => {
      const row = accountRowOf(rawRow)
      const fresh = new Set(days.map((d) => d.day))
      const merged = [...days, ...accountDaysOf(rawRow).filter((d) => !fresh.has(d.day))].sort((a, b) => b.day.localeCompare(a.day)).slice(0, ACCOUNT_DAYS_KEPT)
      // Only this pass's own claim is marked done or given back (one taken over meanwhile is left to its taker).
      const mine = row.claim?.day === passDay && row.claim.env === env && row.claim.at === claimAt
      if (!mine) return { ...row, days: merged }
      if (done) return { ...row, claim: { ...row.claim!, done: true }, days: merged }
      const { claim: _released, ...rest } = row
      return { ...rest, days: merged }
    })
    claimed = null
    return days
  } catch (err) {
    const message = `The daily check of the route's account${claimed ? ` for ${claimed.passDay}` : ""} failed: ${err instanceof Error ? err.message : String(err)}. ${claimed ? "Its claim was given back: a later pass tries again." : ""}`.trim()
    console.error(`[ALERT] video route: ${message}`)
    if (claimed) {
      await alertKept({ key: `account-pass:${claimed.passDay}`, message })
      await releaseAccountPass(claimed.passDay, claimed.at)
    }
    return null
  }
}

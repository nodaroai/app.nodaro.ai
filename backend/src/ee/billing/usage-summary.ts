import { supabase } from "../../lib/supabase.js"
import { usageAmount } from "../../lib/usage-amount.js"
import { deploymentPayerActive, deploymentPayerId } from "../../lib/deployment-payer.js"
import { usageCategoryOf } from "./nodaro-cloud-provider.js"

/**
 * The person's credit usage over a period, summed the way a billing screen
 * draws it: totals, the spend by model and by category, a series over time
 * (by day, week or month, in UTC), and the spend by session and by workflow —
 * what each "project" cost. Spend is read through the one charge reader
 * (`usageAmount`: the settled charge, the hold while a run is open, nothing
 * once refunded); purchases, grants and refunds come from the ledger.
 *
 * Personal money only: a workspace-paid run (`usage_logs.workspace_id`) and
 * an organization's ledger rows (`credit_type = 'org'`) are another wallet.
 * Under a deployment payer a person's runs are attributed to them through
 * `usage_logs.on_behalf_of` (migration 362), and the payer account sees its
 * own; the jobs are always read as the caller's own.
 *
 * Client-side aggregation, read a page at a time (PostgREST answers at most
 * its `max_rows`, 1000, per request and says nothing when it cuts), under a
 * cap: at the cap the figures under-report and `truncated` says so; a failed
 * side read (the jobs, a name) leaves its grouping out and `partial` says so.
 * Economics never leave here: no cost column is read.
 *
 * `GET /v1/credits/usage-summary`.
 */

export const SUMMARY_BUCKETS = ["day", "week", "month"] as const
export type SummaryBucket = (typeof SUMMARY_BUCKETS)[number]

/** The most rows summed from each table. */
export const USAGE_SUMMARY_ROW_CAP = 5000
/** Rows per request: PostgREST's own cap. */
const PAGE = 1000
/** The longest period, in days. */
export const USAGE_SUMMARY_MAX_DAYS = 366

export interface SummaryPeriod {
  readonly from: string
  readonly to: string
  readonly bucket: SummaryBucket
}

export interface SummaryTotals {
  /** Credits spent on runs in the period: each run's charge (the hold while it runs; nothing once refunded). */
  readonly used: number
  /** Credits bought (packs, loads, subscription grants). */
  readonly purchased: number
  /** Credits granted free, net: sign-up and admin adjustments, a grant taken back subtracted. */
  readonly granted: number
  /** Credits given back for a refunded run or by Stripe; a hold released when a run settled below it is not a refund. */
  readonly refunded: number
  /** Runs that were charged or are still running (a side hold beside a run is not a run). */
  readonly runs: number
  /** `used / runs`, rounded to one decimal; 0 with no runs. */
  readonly avgPerRun: number
}

export interface ModelUsage {
  readonly model: string
  readonly provider: string | null
  readonly credits: number
  readonly runs: number
  /** Of `totals.used`, 0–1. */
  readonly share: number
}

export interface CategoryUsage {
  /** `image`, `video`, `audio` or `other`. */
  readonly category: string
  readonly credits: number
  readonly runs: number
}

export interface BucketUsage {
  /** The bucket's first day in UTC (`2026-10-26`; a week by its Monday; a month as `2026-10`). */
  readonly bucket: string
  readonly used: number
  readonly purchased: number
  readonly runs: number
}

export interface GroupUsage {
  readonly id: string
  /** The session's title or the workflow's name; `null` when it has none or is gone. */
  readonly name: string | null
  /** The tool the session belongs to (`image`, `video`, …); sessions only. */
  readonly tool: string | null
  readonly credits: number
  readonly runs: number
  /** The models used, by spend. */
  readonly models: string[]
  /** ISO-8601: the latest run. */
  readonly lastAt: string
}

export interface UsageSummary {
  readonly period: SummaryPeriod
  readonly totals: SummaryTotals
  /** The model with the most spend; `null` with no runs. */
  readonly mostUsed: ModelUsage | null
  readonly byModel: ModelUsage[]
  readonly byCategory: CategoryUsage[]
  /** Every bucket of the period, empty ones included, oldest first; the first may be a partial week or month. */
  readonly overTime: BucketUsage[]
  readonly bySession: GroupUsage[]
  readonly byWorkflow: GroupUsage[]
  /** A read hit the row cap: the figures under-report; narrow the period. */
  readonly truncated: boolean
  /** A side read failed (the jobs, or a session's or workflow's name): a grouping is missing or unnamed; the totals are whole. */
  readonly partial: boolean
}

interface UsageRow {
  job_id: string | null
  created_at: string
  action: string | null
  provider: string | null
  status: string | null
  credits_used: number | null
  credits_charged: number | null
  /** `"side"` on an LLM side hold beside a run (migration 554). */
  reservation_mode?: string | null
}

interface LedgerRow {
  created_at: string
  amount: number | null
  source: string | null
  description: string | null
}

interface JobRow {
  id: string
  job_type: string | null
  session_id: string | null
  workflow_id: string | null
}

const PURCHASE_SOURCES = ["one_time_purchase", "subscription_created", "subscription_renewal"]
const GRANT_SOURCES = ["signup_grant", "admin_adjustment"]
const REFUND_SOURCES = ["refund", "stripe_refund", "paddle_refund"]
/** The ledger row a settlement below the hold writes (migration 392): the hold's unused part going back, not a refund. */
const RELEASED_HOLD = "Unused job reservation"

const pad = (n: number) => String(n).padStart(2, "0")
const dayOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

/** The bucket an instant falls in: its day, the Monday of its week, or its month (UTC). */
export function bucketOf(iso: string, bucket: SummaryBucket): string {
  const d = new Date(iso)
  if (bucket === "month") return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
  if (bucket === "week") {
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
    return dayOf(monday)
  }
  return dayOf(d)
}

/** Every bucket from `from` to `to`, oldest first, so a chart has no holes. */
export function bucketsBetween(from: string, to: string, bucket: SummaryBucket): string[] {
  const out: string[] = []
  const end = new Date(to)
  const cursor = new Date(from)
  const stepTo = (d: Date) => {
    if (bucket === "month") {
      d.setUTCDate(1)
      d.setUTCMonth(d.getUTCMonth() + 1)
    } else d.setUTCDate(d.getUTCDate() + (bucket === "week" ? 7 : 1))
  }
  let key = bucketOf(cursor.toISOString(), bucket)
  while (cursor.getTime() <= end.getTime() && out.length < 1000) {
    if (out[out.length - 1] !== key) out.push(key)
    stepTo(cursor)
    key = bucketOf(cursor.toISOString(), bucket)
  }
  const last = bucketOf(end.toISOString(), bucket)
  if (out[out.length - 1] !== last && out.length < 1000) out.push(last)
  return out
}

interface PageRead<Row> {
  readonly rows: Row[]
  readonly truncated: boolean
  readonly error: { message: string } | null
}

/**
 * Every row of a bounded read, a page at a time, newest first, up to the cap.
 * The query is rebuilt per page (`build`) because a PostgREST builder is not
 * reusable once awaited; the order must be total (`created_at`, then `id`).
 */
async function readAll<Row>(build: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> }): Promise<PageRead<Row>> {
  const rows: Row[] = []
  for (let offset = 0; offset < USAGE_SUMMARY_ROW_CAP; offset += PAGE) {
    const want = Math.min(PAGE, USAGE_SUMMARY_ROW_CAP - offset)
    const { data, error } = await build().range(offset, offset + want - 1)
    if (error) return { rows, truncated: false, error }
    const page = (data ?? []) as Row[]
    rows.push(...page)
    if (page.length < want) return { rows, truncated: false, error: null }
  }
  return { rows, truncated: true, error: null }
}

const CHUNK = 200
const PARALLEL = 4

/** `in` over many ids, in chunks PostgREST's URL can carry, a few at a time; the caller's own jobs only. */
async function jobsOf(userId: string, ids: readonly string[]): Promise<{ rows: JobRow[]; error: string | null }> {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK))
  const rows: JobRow[] = []
  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const results = await Promise.all(
      chunks.slice(i, i + PARALLEL).map((chunk) => supabase.from("jobs").select("id, job_type, session_id, workflow_id").eq("user_id", userId).in("id", chunk)),
    )
    for (const { data, error } of results) {
      if (error) return { rows, error: error.message }
      rows.push(...((data ?? []) as JobRow[]))
    }
  }
  return { rows, error: null }
}

async function namesOf(table: "generation_sessions" | "workflows", userId: string, ids: readonly string[], columns: string): Promise<{ names: Map<string, Record<string, unknown>>; error: string | null }> {
  const names = new Map<string, Record<string, unknown>>()
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase.from(table).select(columns).eq("user_id", userId).in("id", ids.slice(i, i + CHUNK))
    if (error) return { names, error: error.message }
    for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) names.set(String(row.id), row)
  }
  return { names, error: null }
}

interface Agg {
  credits: number
  runs: number
  provider: string | null
  lastAt: string
  models: Map<string, number>
}

const agg = (): Agg => ({ credits: 0, runs: 0, provider: null, lastAt: "", models: new Map() })

function add(map: Map<string, Agg>, key: string, row: UsageRow, credits: number, run: boolean): void {
  const a = map.get(key) ?? agg()
  a.credits += credits
  if (run) a.runs += 1
  a.provider ??= row.provider
  if (row.created_at > a.lastAt) a.lastAt = row.created_at
  const model = row.action ?? "unknown"
  a.models.set(model, (a.models.get(model) ?? 0) + credits)
  map.set(key, a)
}

const bySpend = <T extends { credits: number }>(items: T[]): T[] => [...items].sort((x, y) => y.credits - x.credits)

/** What a side read's failure is reported through. */
export type SummaryErrorReport = (table: string, message: string) => void
const quiet: SummaryErrorReport = () => {}

/** The person's usage summary for the period. */
export async function usageSummaryFor(userId: string, period: SummaryPeriod, report: SummaryErrorReport = quiet): Promise<UsageSummary | { readonly error: unknown }> {
  // Under a deployment payer a person's runs sit on the payer's logs, attributed through on_behalf_of.
  const attributed = deploymentPayerActive() && userId !== deploymentPayerId()
  const usage = await readAll<UsageRow>(() =>
    supabase
      .from("usage_logs")
      .select("job_id, created_at, action, provider, status, credits_used, credits_charged, reservation_mode:metadata->>reservation_mode")
      .eq(attributed ? "on_behalf_of" : "user_id", userId)
      .is("workspace_id", null) // a workspace-paid run is another wallet
      .in("status", ["reserved", "committed"]) // a refunded run is not consumption
      .gte("created_at", period.from)
      .lte("created_at", period.to)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
  )
  if (usage.error) return { error: usage.error }
  const ledger = await readAll<LedgerRow>(() =>
    supabase
      .from("credit_transactions")
      .select("created_at, amount, source, description")
      .eq("user_id", userId)
      .neq("credit_type", "org")
      .in("source", [...PURCHASE_SOURCES, ...GRANT_SOURCES, ...REFUND_SOURCES])
      .gte("created_at", period.from)
      .lte("created_at", period.to)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
  )
  if (ledger.error) return { error: ledger.error }

  const runs = usage.rows
  const movements = ledger.rows
  const truncated = usage.truncated || ledger.truncated
  let partial = false

  const jobIds = [...new Set(runs.map((r) => r.job_id).filter((id): id is string => typeof id === "string" && id.length > 0))]
  const jobs = await jobsOf(userId, jobIds)
  if (jobs.error) {
    report("jobs", jobs.error)
    partial = true
  }
  const jobOf = new Map(jobs.rows.map((j) => [j.id, j]))

  const byModel = new Map<string, Agg>()
  const byCategory = new Map<string, Agg>()
  const bySession = new Map<string, Agg>()
  const byWorkflow = new Map<string, Agg>()
  const byBucket = new Map<string, { used: number; purchased: number; runs: number }>()
  for (const key of bucketsBetween(period.from, period.to, period.bucket)) byBucket.set(key, { used: 0, purchased: 0, runs: 0 })
  const bucketEntry = (at: string) => {
    const key = bucketOf(at, period.bucket)
    const entry = byBucket.get(key) ?? { used: 0, purchased: 0, runs: 0 }
    byBucket.set(key, entry)
    return entry
  }

  let used = 0
  let runCount = 0
  for (const row of runs) {
    const credits = usageAmount(row) ?? 0
    const run = row.reservation_mode !== "side"
    used += credits
    if (run) runCount += 1
    add(byModel, row.action ?? "unknown", row, credits, run)
    const job = row.job_id ? jobOf.get(row.job_id) : undefined
    // The node type names the category outright (`generate-image`, `image-to-video`); the model id is the fallback.
    add(byCategory, usageCategoryOf(job?.job_type ?? row.action ?? ""), row, credits, run)
    if (job?.session_id) add(bySession, job.session_id, row, credits, run)
    if (job?.workflow_id) add(byWorkflow, job.workflow_id, row, credits, run)
    const b = bucketEntry(row.created_at)
    b.used += credits
    if (run) b.runs += 1
  }

  let purchased = 0
  let granted = 0
  let refunded = 0
  for (const m of movements) {
    const amount = m.amount ?? 0
    const source = m.source ?? ""
    if (PURCHASE_SOURCES.includes(source)) {
      purchased += amount
      bucketEntry(m.created_at).purchased += amount
    } else if (GRANT_SOURCES.includes(source)) {
      granted += amount // a grant taken back is a negative adjustment: net
    } else if (REFUND_SOURCES.includes(source) && amount > 0 && m.description !== RELEASED_HOLD) {
      refunded += amount
    }
  }

  const [sessions, workflows] = await Promise.all([
    bySession.size ? namesOf("generation_sessions", userId, [...bySession.keys()], "id, title, tool") : { names: new Map<string, Record<string, unknown>>(), error: null },
    byWorkflow.size ? namesOf("workflows", userId, [...byWorkflow.keys()], "id, name") : { names: new Map<string, Record<string, unknown>>(), error: null },
  ])
  for (const [table, read] of [["generation_sessions", sessions], ["workflows", workflows]] as const) {
    if (read.error) {
      report(table, read.error)
      partial = true
    }
  }

  const modelsOf = (a: Agg) => [...a.models.entries()].sort((x, y) => y[1] - x[1]).map(([model]) => model)
  const group = (map: Map<string, Agg>, names: Map<string, Record<string, unknown>>, nameKey: "title" | "name"): GroupUsage[] =>
    bySpend(
      [...map.entries()].map(([id, a]) => {
        const row = names.get(id)
        return {
          id,
          name: typeof row?.[nameKey] === "string" ? (row[nameKey] as string) : null,
          tool: typeof row?.tool === "string" ? (row.tool as string) : null,
          credits: a.credits,
          runs: a.runs,
          models: modelsOf(a),
          lastAt: a.lastAt,
        }
      }),
    )

  const models = bySpend([...byModel.entries()].map(([model, a]) => ({ model, provider: a.provider, credits: a.credits, runs: a.runs, share: used > 0 ? Math.round((a.credits / used) * 1000) / 1000 : 0 })))
  return {
    period,
    totals: { used, purchased, granted, refunded, runs: runCount, avgPerRun: runCount > 0 ? Math.round((used / runCount) * 10) / 10 : 0 },
    mostUsed: models[0] ?? null,
    byModel: models,
    byCategory: bySpend([...byCategory.entries()].map(([category, a]) => ({ category, credits: a.credits, runs: a.runs }))),
    overTime: [...byBucket.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([bucket, v]) => ({ bucket, ...v })),
    bySession: group(bySession, sessions.names, "title"),
    byWorkflow: group(byWorkflow, workflows.names, "name"),
    truncated,
    partial,
  }
}

import { supabase } from "./supabase.js"
import { usageAmount } from "./usage-amount.js"

/**
 * The person's credit history as one list: every movement of their balance —
 * a run's hold, a purchase, a grant, a refund, an adjustment, an expiry — in
 * the order it happened, with the balance after each one. The spine is the
 * ledger (`credit_transactions`, personal rows only: an organization's rows
 * carry `credit_type: 'org'` and never moved this balance); a row with a job
 * is enriched from the job's usage log (the model) and from the job itself
 * (what kind of run, when it ran, which session and workflow), and the job's
 * RESERVE row — the hold taken when the run was accepted — carries the job's
 * `charge`, read through the one charge reader: the settled charge, the hold
 * while the run is open, 0 once refunded. A job can have other rows (a refund,
 * a metered overrun line); those carry no charge, so summing `charge` over a
 * list counts each job once. A purchase carries its receipt.
 *
 * Economics never leave here: no cost column is selected (`usage_logs.cost_usd`,
 * `jobs.provider_cost`, `jobs.display_cost`), only the person's own credits.
 *
 * Shared by `GET /v1/credits/history` (a page, or the CSV export).
 */

export const HISTORY_KINDS = ["usage", "purchase", "grant", "refund", "app", "adjustment", "expiry"] as const
export type HistoryKind = (typeof HISTORY_KINDS)[number]

/**
 * The ledger `source` values each kind covers — every value the column's
 * CHECK allows (migration 365) except the organization ones, which never
 * reach a personal list. `adjustment` is the rest: an admin's correction, the
 * legacy spellings, and any value a later migration adds (the guard test
 * compares this map to the CHECK).
 */
export const SOURCES_OF_KIND: Readonly<Record<Exclude<HistoryKind, "adjustment">, readonly string[]>> = {
  usage: ["usage"],
  purchase: ["one_time_purchase", "subscription_created", "subscription_renewal", "purchase", "subscription", "renewal", "topup"],
  grant: ["signup_grant"],
  refund: ["refund", "stripe_refund", "paddle_refund"],
  /** Credits earned from, or paid for, a published app. */
  app: ["app_earnings", "app_markup"],
  expiry: ["expiry"],
}
/** The sources `adjustment` names explicitly (besides being the rest). */
export const ADJUSTMENT_SOURCES: readonly string[] = ["admin_adjustment", "admin", "adjustment"]

const NAMED_SOURCES = Object.values(SOURCES_OF_KIND).flat()

export function kindOfSource(source: string | null): HistoryKind {
  for (const kind of Object.keys(SOURCES_OF_KIND) as Array<Exclude<HistoryKind, "adjustment">>) {
    if (SOURCES_OF_KIND[kind].includes(source ?? "")) return kind
  }
  return "adjustment"
}

/** The most rows one page lists. */
export const CREDIT_HISTORY_PAGE_MAX = 100
/** The most rows the CSV export carries; the file says so on its last line when it is cut. */
export const CREDIT_HISTORY_EXPORT_MAX = 5000
/** Rows read per step while exporting: under PostgREST's `max_rows` (1000), and a URL's worth of ids to enrich. */
const EXPORT_STEP = 200

export interface HistoryFilters {
  readonly kind?: HistoryKind
  /** A model identifier (`usage_logs.action`): only that model's runs. */
  readonly model?: string
  /** ISO-8601 bounds on `created_at`, inclusive. */
  readonly from?: string
  readonly to?: string
  /** Words looked for in the row's description, case-insensitively. */
  readonly q?: string
}

export interface HistoryJob {
  readonly id: string
  /** The node type that ran (`generate-image`, `image-to-video`, …); `null` when the job is gone or not the person's. */
  readonly type: string | null
  readonly status: string | null
  readonly startedAt: string | null
  readonly completedAt: string | null
  /** From start to completion; `null` until it completes. */
  readonly durationMs: number | null
  readonly workflowId: string | null
  readonly sessionId: string | null
}

export interface HistoryEntry {
  readonly id: string
  /** ISO-8601. */
  readonly at: string
  readonly kind: HistoryKind
  /** The ledger's own word for it (`usage`, `one_time_purchase`, `subscription_renewal`, …). */
  readonly source: string
  /** The movement, signed: a run's hold is negative, a purchase positive. */
  readonly amount: number
  /** The balance right after this movement. */
  readonly balanceAfter: number
  /** Which pool moved; `mixed` when both did. */
  readonly pool: "subscription" | "topup" | "mixed"
  readonly description: string | null
  /** The model that ran, on a row with a job. */
  readonly model: string | null
  readonly provider: string | null
  /**
   * The job's charge, on its reserve row only: the settled charge, the hold
   * while the run is open, 0 once refunded. `null` on every other row (a
   * refund, a metered overrun line, a purchase), so summing it counts each
   * job once.
   */
  readonly charge: number | null
  /** The run's credit status (`reserved`, `committed` or `refunded`), beside `charge`. */
  readonly status: string | null
  readonly job: HistoryJob | null
  /** Stripe's hosted receipt, on a purchase that has one. */
  readonly receiptUrl: string | null
}

export interface HistoryPage {
  readonly items: HistoryEntry[]
  /** The cursor of the next page when this one is full, else null. */
  readonly nextCursor: string | null
}

/** Where a read failed; the page still lists the movements, with that field null. */
export type HistoryErrorReport = (table: string, message: string) => void

interface LedgerRow {
  id: string
  created_at: string
  amount: number | null
  credit_type: string | null
  source: string | null
  description: string | null
  job_id: string | null
  stripe_transaction_id: string | null
  balance_after: number | null
}

interface UsageRow {
  job_id: string | null
  created_at: string
  action: string | null
  provider: string | null
  status: string | null
  credits_used: number | null
  credits_charged: number | null
}

interface JobRow {
  id: string
  job_type: string | null
  status: string | null
  started_at: string | null
  completed_at: string | null
  workflow_id: string | null
  session_id: string | null
}

/** `%`, `_` and `*` are PostgREST's wildcards; a search term means them literally. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_*]/g, (c) => `\\${c}`)
}

/** A model identifier as the ledger writes it: letters, digits and `: . _ / -` — nothing PostgREST's `or()` reads as syntax. */
export const MODEL_FILTER = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,119}$/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The paging cursor: the last row's `created_at` and `id`, so rows written in the same instant page without a seam. */
export function cursorOf(entry: Pick<HistoryEntry, "at" | "id">): string {
  return `${entry.at}|${entry.id}`
}

/** The cursor's two parts; `null` when it is not one of ours. */
export function parseCursor(cursor: string): { readonly at: string; readonly id: string } | null {
  const [at, id, ...rest] = cursor.split("|")
  if (!at || !id || rest.length > 0 || !UUID.test(id) || Number.isNaN(Date.parse(at))) return null
  return { at, id }
}

function ledgerQuery(userId: string, filters: HistoryFilters, limit: number, cursor?: { at: string; id: string }) {
  let query = supabase
    .from("credit_transactions")
    .select("id, created_at, amount, credit_type, source, description, job_id, stripe_transaction_id, balance_after")
    .eq("user_id", userId)
    .neq("credit_type", "org")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit)
  if (cursor) query = query.or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`)
  if (filters.kind === "adjustment") query = query.not("source", "in", `(${NAMED_SOURCES.join(",")})`)
  else if (filters.kind) query = query.in("source", [...SOURCES_OF_KIND[filters.kind]])
  if (filters.from) query = query.gte("created_at", filters.from)
  if (filters.to) query = query.lte("created_at", filters.to)
  if (filters.q) query = query.ilike("description", `%${escapeLike(filters.q)}%`)
  if (filters.model) {
    // A job's rows are described `Job <id>: <model>`, then ` (on behalf of …)`
    // on a deployment payer's row and ` — usage above the hold` on a metered
    // overrun line (ee/billing/credits.ts, migration 551). The model exactly.
    const m = escapeLike(filters.model)
    query = query.or(`description.ilike.Job %: ${m},description.ilike.Job %: ${m} (%,description.ilike.Job %: ${m} —%`)
  }
  return query
}

const unique = (values: ReadonlyArray<string | null>): string[] => [...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0))]

interface Enrichment {
  readonly logOf: Map<string, UsageRow>
  readonly jobOf: Map<string, JobRow>
  readonly receiptOf: Map<string, string | null>
}

/**
 * The usage logs, jobs and receipts the rows point at — the person's own
 * (under a deployment payer the payer's ledger carries its requesters' jobs,
 * which stay theirs: such a row shows the job's id alone). Best-effort: a read
 * that fails is reported and leaves its field null on every row.
 */
async function enrichment(userId: string, rows: readonly LedgerRow[], report: HistoryErrorReport): Promise<Enrichment> {
  const jobIds = unique(rows.map((r) => r.job_id))
  const stripeIds = unique(rows.map((r) => r.stripe_transaction_id))
  const none = { data: [], error: null }
  const [logs, jobs, receipts] = await Promise.all([
    jobIds.length
      ? supabase.from("usage_logs").select("job_id, created_at, action, provider, status, credits_used, credits_charged").eq("user_id", userId).in("job_id", jobIds).order("created_at", { ascending: true })
      : Promise.resolve(none),
    jobIds.length
      ? // trash-read: a statement shows what a run cost even after the job went to the Trash; only its kind, timing, session and workflow are read, never its content
        supabase.from("jobs").select("id, job_type, status, started_at, completed_at, workflow_id, session_id").eq("user_id", userId).in("id", jobIds)
      : Promise.resolve(none),
    stripeIds.length
      ? supabase.from("transactions").select("stripe_transaction_id, receipt_url").eq("user_id", userId).in("stripe_transaction_id", stripeIds)
      : Promise.resolve(none),
  ])
  for (const [name, result] of [["usage_logs", logs], ["jobs", jobs], ["transactions", receipts]] as const) {
    if (result.error) report(name, result.error.message)
  }
  const logOf = new Map<string, UsageRow>()
  // Oldest first: a job's first log is its reserve; an add-on's log (a loop trim, a refine) comes later and is not the job's charge.
  for (const log of (logs.data ?? []) as UsageRow[]) if (log.job_id && !logOf.has(log.job_id)) logOf.set(log.job_id, log)
  const jobOf = new Map(((jobs.data ?? []) as JobRow[]).map((job) => [job.id, job]))
  const receiptOf = new Map(((receipts.data ?? []) as Array<{ stripe_transaction_id: string; receipt_url: string | null }>).map((r) => [r.stripe_transaction_id, r.receipt_url]))
  return { logOf, jobOf, receiptOf }
}

function durationMs(job: JobRow): number | null {
  if (!job.started_at || !job.completed_at) return null
  const ms = Date.parse(job.completed_at) - Date.parse(job.started_at)
  return Number.isFinite(ms) && ms >= 0 ? ms : null
}

/** The job's reserve row: the usage row whose movement is the hold the log took. */
const isReserveRow = (row: LedgerRow, log: UsageRow | undefined): boolean =>
  row.source === "usage" && log !== undefined && log.credits_used !== null && row.amount === -log.credits_used

function entryOf(row: LedgerRow, { logOf, jobOf, receiptOf }: Enrichment): HistoryEntry {
  const log = row.job_id ? logOf.get(row.job_id) : undefined
  const job = row.job_id ? jobOf.get(row.job_id) : undefined
  const reserve = isReserveRow(row, log)
  return {
    id: row.id,
    at: row.created_at,
    kind: kindOfSource(row.source),
    source: row.source ?? "unknown",
    amount: row.amount ?? 0,
    balanceAfter: row.balance_after ?? 0,
    pool: row.credit_type === "topup" ? "topup" : row.credit_type === "mixed" ? "mixed" : "subscription",
    description: row.description,
    model: log?.action ?? null,
    provider: log?.provider ?? null,
    charge: reserve && log ? usageAmount(log) : null,
    status: reserve && log ? (log.status ?? null) : null,
    job: job
      ? { id: job.id, type: job.job_type, status: job.status, startedAt: job.started_at, completedAt: job.completed_at, durationMs: durationMs(job), workflowId: job.workflow_id, sessionId: job.session_id }
      : row.job_id
        ? { id: row.job_id, type: null, status: null, startedAt: null, completedAt: null, durationMs: null, workflowId: null, sessionId: null }
        : null,
    receiptUrl: row.stripe_transaction_id ? (receiptOf.get(row.stripe_transaction_id) ?? null) : null,
  }
}

const quiet: HistoryErrorReport = () => {}

/** One page of the person's history, newest first. A cursor that is not one of ours answers `{ badCursor: true }`. */
export async function listCreditHistory(
  userId: string,
  filters: HistoryFilters,
  page: { readonly limit: number; readonly cursor?: string },
  report: HistoryErrorReport = quiet,
): Promise<HistoryPage | { readonly error: unknown } | { readonly badCursor: true }> {
  const cursor = page.cursor === undefined ? undefined : parseCursor(page.cursor)
  if (cursor === null) return { badCursor: true }
  const { data, error } = await ledgerQuery(userId, filters, page.limit, cursor)
  if (error) return { error }
  const rows = (data ?? []) as LedgerRow[]
  const items = rows.map((row) => entryOf(row, { logOf: new Map(), jobOf: new Map(), receiptOf: new Map() }))
  const enriched = rows.length ? await enrichment(userId, rows, report) : null
  const out = enriched ? rows.map((row) => entryOf(row, enriched)) : items
  const last = out[out.length - 1]
  return { items: out, nextCursor: out.length === page.limit && last ? cursorOf(last) : null }
}

const CSV_COLUMNS = ["at", "kind", "source", "amount", "charge", "balanceAfter", "pool", "status", "model", "provider", "jobId", "jobType", "durationMs", "sessionId", "workflowId", "receiptUrl", "description"] as const

/**
 * A cell: a number as it is (so the column sums in a spreadsheet); text
 * quoted when it holds a comma, a quote or a line break, and a leading
 * formula character neutralised.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return String(value)
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** The entries as CSV (a header line, then one line per entry), newest first. */
export function historyCsv(items: readonly HistoryEntry[], truncated = false): string {
  const lines = [CSV_COLUMNS.join(",")]
  for (const e of items) {
    const cells = [e.at, e.kind, e.source, e.amount, e.charge, e.balanceAfter, e.pool, e.status, e.model, e.provider, e.job?.id ?? null, e.job?.type ?? null, e.job?.durationMs ?? null, e.job?.sessionId ?? null, e.job?.workflowId ?? null, e.receiptUrl, e.description]
    lines.push(cells.map(csvCell).join(","))
  }
  if (truncated) lines.push(csvCell(`(cut at ${CREDIT_HISTORY_EXPORT_MAX} rows: narrow the dates for the rest)`))
  return `${lines.join("\r\n")}\r\n`
}

/**
 * The whole filtered history as CSV, newest first, at most
 * {@link CREDIT_HISTORY_EXPORT_MAX} rows — read a step at a time (each under
 * PostgREST's row cap, each enriched on its own), and marked as cut only when
 * a row beyond the maximum exists.
 */
export async function exportCreditHistory(userId: string, filters: HistoryFilters, report: HistoryErrorReport = quiet): Promise<{ readonly csv: string } | { readonly error: unknown }> {
  const items: HistoryEntry[] = []
  let cursor: string | undefined
  let truncated = false
  while (items.length < CREDIT_HISTORY_EXPORT_MAX) {
    const limit = Math.min(EXPORT_STEP, CREDIT_HISTORY_EXPORT_MAX - items.length)
    const page = await listCreditHistory(userId, filters, { limit, cursor }, report)
    if ("error" in page) return page
    if ("badCursor" in page) return { error: new Error("export cursor") }
    items.push(...page.items)
    if (page.nextCursor === null) break
    cursor = page.nextCursor
    if (items.length >= CREDIT_HISTORY_EXPORT_MAX) {
      const beyond = await listCreditHistory(userId, filters, { limit: 1, cursor }, report)
      truncated = !("error" in beyond) && !("badCursor" in beyond) && beyond.items.length > 0
    }
  }
  return { csv: historyCsv(items, truncated) }
}

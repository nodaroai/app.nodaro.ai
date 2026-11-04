/**
 * The admin Motion price check's wire contract: what its three routes answer
 * (ee/routes/admin-motion-price-check.ts), and the mapping from the database
 * functions' rows (`admin_motion_run_list`, `admin_motion_runs`,
 * `admin_motion_tree`, migration `*_admin_motion_price_check.sql`) into it.
 * The admin page mirrors these types exactly.
 *
 * Every figure is the database's: this module renames, reads numbers that
 * PostgREST may send as strings, and lays a run's steps out against its
 * recorded quote. Nothing is rounded here (the page rounds for display), and
 * a figure that is not there is null, never 0 — a run still in flight has no
 * difference yet, and a totals group with no settled run sums to nothing.
 */
import { CREDIT_BASE_USD } from "@nodaro/shared/models"
import { QUOTED_EXTRAS, readExtrasRecord, readQuoteRecord, readReuseRecord, type QuoteRecord, type QuotedExtra } from "./records.js"
import { quoteLineOf, reusedOf, stepOf, type StepIdentity } from "./steps.js"

export type MotionEngine = "prism" | "pulse"
export type MotionStyle = "precise" | "flex"
export type MotionKind = "trend" | "hand"
export type MotionSort = "margin_usd" | "margin_pct" | "paid_usd" | "taken" | "created_at"

export interface MotionPriceRun {
  id: string
  createdAt: string
  userId: string
  email: string | null
  status: string
  fullQuality: boolean
  draftJobId: string | null
  kind: MotionKind
  trendName: string | null
  engine: MotionEngine
  style: MotionStyle
  resolution: string | null
  draft: boolean
  lengthSec: number | null
  held: number | null
  /**
   * What was taken. While the run is in flight (`settled` false) it is the
   * running total so far, or null while the run's own hold is still open.
   */
  taken: number | null
  settled: boolean
  takenUsd: number | null
  recordedUsd: number | null
  kieUsd: number | null
  paidUsd: number
  /** Taken in USD less paid; null until the run has settled with something taken. */
  marginUsd: number | null
  marginPct: number | null
  steps: number
  stepsWithoutCost: number
  quoteTotal: number | null
  /** The hold plus the credits of the quoted extras that ran. */
  quoteAllowed: number | null
  /** Only ever set on a settled run. */
  flags: { paidAboveTaken: boolean; missingCost: boolean; aboveQuote: boolean }
}

/** One totals row. Its figures sum the group's settled runs only: null when it has none. */
export interface MotionPriceTotal {
  dimension: "all" | "engine" | "resolution" | "style"
  value: string | null
  runs: number
  unsettled: number
  held: number | null
  taken: number | null
  takenUsd: number | null
  paidUsd: number | null
  marginUsd: number | null
  marginPct: number | null
}

export interface MotionPriceList {
  total: number
  runs: MotionPriceRun[]
  totals: MotionPriceTotal[]
  kieApplied: boolean
}

export interface MotionPriceStep {
  jobId: string
  parentJobId: string | null
  depth: number
  name: string
  role: number | null
  route: string
  provider: string | null
  model: string | null
  providerTaskId: string | null
  status: string
  held: number | null
  taken: number | null
  open: boolean
  takenUsd: number | null
  recordedUsd: number | null
  kieUsd: number | null
  paidUsd: number | null
  local: boolean
  missingCost: boolean
  quoteLine: string | null
}

export interface MotionPriceQuoteLine {
  line: string
  label: string
  quoted: number
  expected: number | null
  /**
   * Beside the hold, not in it: the two extras, and an "auto" masking
   * quote's `privacy` line (it repeats `privacyCredits`: the masking runs
   * only after a refusal, so the hold leaves it out).
   */
  outsideTotal: boolean
  /** An extra: whether it ran (counted in quoteAllowed only then); null on every other line. */
  ran: boolean | null
  steps: number
  held: number
  taken: number
}

export interface MotionPriceReused {
  step: string
  name: string
  role: number | null
  jobId: string | null
  count: number
  quoteLine: string | null
}

export interface MotionPriceRunDetail {
  run: MotionPriceRun
  quote: { totalCredits: number; expectedCredits: number | null; lines: MotionPriceQuoteLine[] } | null
  steps: MotionPriceStep[]
  reuse: { recorded: "yes" | "none" | "not-recorded"; entries: MotionPriceReused[] }
}

export interface KieRealResult {
  kieUsd: Record<string, number>
  window: { from: string; to: string }
  motionTasks: number
  matched: number
  truncated: boolean
  kieRecords: number
  capped: string[]
  errors: Record<string, string>
  fetchedAt: string
}

type Row = Record<string, unknown>

const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v)
const rowsOf = (v: unknown): Row[] => (Array.isArray(v) ? v.filter(isRow) : [])

const NUMERIC = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/

/** A figure as PostgREST sends it: a number, or a numeric string (NUMERIC, BIGINT); anything else is none. */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v !== "string" || !NUMERIC.test(v)) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null)

/** One run row (admin_motion_runs, or a page row of admin_motion_run_list) as the wire's run. */
export function runOfRow(row: Record<string, unknown>): MotionPriceRun {
  return {
    id: str(row.id) ?? "",
    createdAt: str(row.created_at) ?? "",
    userId: str(row.user_id) ?? "",
    email: str(row.email),
    status: str(row.status) ?? "",
    fullQuality: row.full_quality === true,
    draftJobId: str(row.draft_job_id),
    kind: row.kind === "trend" ? "trend" : "hand",
    trendName: str(row.trend_name),
    engine: row.engine === "pulse" ? "pulse" : "prism",
    style: row.style === "flex" ? "flex" : "precise",
    resolution: str(row.resolution),
    draft: row.draft === true,
    lengthSec: num(row.length_sec),
    held: num(row.held),
    taken: num(row.taken),
    settled: row.settled === true,
    takenUsd: num(row.taken_usd),
    recordedUsd: num(row.recorded_usd),
    kieUsd: num(row.kie_usd),
    paidUsd: num(row.paid_usd) ?? 0,
    marginUsd: num(row.margin_usd),
    marginPct: num(row.margin_pct),
    steps: num(row.steps) ?? 0,
    stepsWithoutCost: num(row.steps_without_cost) ?? 0,
    quoteTotal: num(row.quote_total),
    quoteAllowed: num(row.quote_allowed),
    flags: {
      paidAboveTaken: row.flag_paid_above_taken === true,
      missingCost: row.flag_missing_cost === true,
      aboveQuote: row.flag_above_quote === true,
    },
  }
}

const DIMENSIONS: readonly MotionPriceTotal["dimension"][] = ["all", "engine", "resolution", "style"]

/** One totals row of admin_motion_run_list as the wire's. */
export function totalOfRow(row: Record<string, unknown>): MotionPriceTotal {
  const dimension = DIMENSIONS.find((d) => d === row.dimension) ?? "all"
  return {
    dimension,
    value: str(row.value),
    runs: num(row.runs) ?? 0,
    unsettled: num(row.unsettled) ?? 0,
    held: num(row.held),
    taken: num(row.taken),
    takenUsd: num(row.taken_usd),
    paidUsd: num(row.paid_usd),
    marginUsd: num(row.margin_usd),
    marginPct: num(row.margin_pct),
  }
}

/** admin_motion_run_list's one JSON value as the list; `kieApplied` says whether the caller sent KIE's figures. */
export function listOf(value: unknown, kieApplied: boolean): MotionPriceList {
  const out = isRow(value) ? value : {}
  return {
    total: num(out.total) ?? 0,
    runs: rowsOf(out.runs).map(runOfRow),
    totals: rowsOf(out.totals).map(totalOfRow),
    kieApplied,
  }
}

/** The lines in the order the page lists them; any other line follows, by name. */
const LINE_ORDER: readonly string[] = ["base", "motion", "motionHd", "references", "referenceAudio", "prompt", "privacy", "styleRefs"]

/** Names in a breakdown that are never lines of their own: the render's expected settlement, and the two extras' names. */
const NOT_LINES: ReadonlySet<string> = new Set(["motionExpected", ...QUOTED_EXTRAS])

const LABELS: ReadonlyMap<string, string> = new Map([
  ["base", "Base fee"],
  ["motion", "Render"],
  ["motionHd", "1080p render"],
  ["references", "References"],
  ["referenceAudio", "Reference audio"],
  ["prompt", "Prompt writing"],
  ["privacy", "Privacy"],
  ["styleRefs", "Styled role pictures"],
  // The two extras: their line's `outsideTotal` says they are beside the hold (the drawer tags it), so their names don't.
  ["privacyCredits", "Privacy retry"],
  ["referencesRetryCredits", "Sheet retry"],
])

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** The steps mapped to a line: how many, and their held and taken (a figure not there counts 0). */
function sumsOf(steps: readonly MotionPriceStep[], line: string): Pick<MotionPriceQuoteLine, "steps" | "held" | "taken"> {
  const mapped = steps.filter((s) => s.quoteLine === line)
  return {
    steps: mapped.length,
    held: mapped.reduce((n, s) => n + (s.held ?? 0), 0),
    taken: mapped.reduce((n, s) => n + (s.taken ?? 0), 0),
  }
}

/**
 * Whether the quote's `privacy` line sits beside the hold: an "auto" masking
 * quote's, which repeats `privacyCredits` and is in neither total. It is
 * told by the arithmetic, never by the two figures being equal (a Full
 * depth's privacy is in the hold beside a retry extra of its own, and the
 * two may coincide): the extra is recorded, privacy is above 0, and the
 * other lines alone make the hold exactly.
 */
function privacyOutsideHold(quote: QuoteRecord, lines: readonly string[]): boolean {
  const privacy = quote.breakdown.privacy ?? 0
  const others = lines.filter((line) => line !== "privacy").reduce((n, line) => n + (quote.breakdown[line] ?? 0), 0)
  return quote.privacyCredits !== null && privacy > 0 && others === quote.totalCredits
}

/**
 * The quote's lines: the breakdown's in `LINE_ORDER`, then its unknown ones
 * by name (`motionExpected` as the motion line's `expected`), then each
 * extra the quote records, outside the hold, marked with whether it ran. An
 * "auto" masking quote's privacy line is outside the hold too
 * (`privacyOutsideHold`).
 */
function quoteLines(quote: QuoteRecord, ran: readonly QuotedExtra[], steps: readonly MotionPriceStep[]): MotionPriceQuoteLine[] {
  const names = Object.keys(quote.breakdown).filter((name) => !NOT_LINES.has(name))
  const ordered = [
    ...LINE_ORDER.filter((name) => names.includes(name)),
    ...names.filter((name) => !LINE_ORDER.includes(name)).sort(byName),
  ]
  const expected = Object.hasOwn(quote.breakdown, "motionExpected") ? quote.breakdown.motionExpected ?? null : null
  const privacyOutside = privacyOutsideHold(quote, ordered)
  const fromBreakdown = ordered.map((line): MotionPriceQuoteLine => ({
    line,
    label: LABELS.get(line) ?? line,
    quoted: quote.breakdown[line] ?? 0,
    expected: line === "motion" ? expected : null,
    outsideTotal: line === "privacy" && privacyOutside,
    ran: null,
    ...sumsOf(steps, line),
  }))
  const extras = QUOTED_EXTRAS.flatMap((line): MotionPriceQuoteLine[] => {
    const quoted = quote[line]
    if (quoted === null) return []
    return [{ line, label: LABELS.get(line) ?? line, quoted, expected: null, outsideTotal: true, ran: ran.includes(line), ...sumsOf(steps, line) }]
  })
  return [...fromBreakdown, ...extras]
}

const timeOf = (v: unknown): number => {
  const t = typeof v === "string" ? Date.parse(v) : Number.NaN
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

/** The run's own row first, then every step by when it started, then by job id. */
function stepOrder(a: Row, b: Row): number {
  const rootFirst = Number(num(a.depth) !== 0) - Number(num(b.depth) !== 0)
  if (rootFirst !== 0) return rootFirst
  const ta = timeOf(a.created_at)
  const tb = timeOf(b.created_at)
  if (ta !== tb) return ta < tb ? -1 : 1
  return byName(str(a.job_id) ?? "", str(b.job_id) ?? "")
}

function stepOfRow(row: Row, step: StepIdentity, quoteLine: string | null): MotionPriceStep {
  const taken = num(row.taken)
  return {
    jobId: str(row.job_id) ?? "",
    parentJobId: str(row.parent_job_id),
    depth: num(row.depth) ?? 0,
    name: step.name,
    role: step.role,
    route: str(row.route) ?? "",
    provider: str(row.provider),
    model: str(row.model),
    providerTaskId: str(row.provider_task_id),
    status: str(row.status) ?? "",
    held: num(row.held),
    taken,
    open: row.log_status === "reserved",
    takenUsd: taken === null ? null : taken * CREDIT_BASE_USD,
    recordedUsd: num(row.recorded_usd),
    kieUsd: num(row.kie_usd),
    paidUsd: num(row.paid_usd),
    local: step.local,
    missingCost: row.no_cost === true,
    quoteLine,
  }
}

/**
 * One run's drill-down from its admin_motion_runs row (with its quote, reuse
 * and extras records) and its admin_motion_tree rows: the run, its recorded
 * quote's lines with the steps each covers, its steps (the run's own row
 * first, then by start), and what it reused. A run is a depth-map run when a
 * step made its depth map or it reused the trend's stored one.
 */
export function runDetailOf(runRow: Record<string, unknown>, treeRows: Record<string, unknown>[]): MotionPriceRunDetail {
  const run = runOfRow(runRow)
  const quote = readQuoteRecord(runRow.quote)
  const reused = readReuseRecord(runRow.reuse)
  const ran = readExtrasRecord(runRow.extras) ?? []
  const rows = treeRows.filter((r) => str(r.run_id) === null || str(r.run_id) === run.id).sort(stepOrder)
  const identities = rows.map((r) => stepOf({ depth: num(r.depth) ?? 0, route: str(r.route) ?? "", step_key: str(r.step_key) }, run.id, run.fullQuality))
  const depthMapRun = identities.some((s) => s.kind === "depth-map") || (reused ?? []).some((e) => e.step === "depth")
  const steps = rows.map((r, i) => {
    const step = identities[i]!
    return stepOfRow(r, step, quoteLineOf(step, { quote, depthMapRun }))
  })
  return {
    run,
    quote: quote ? { totalCredits: quote.totalCredits, expectedCredits: quote.expectedCredits, lines: quoteLines(quote, ran, steps) } : null,
    steps,
    reuse: {
      recorded: reused ? "yes" : quote ? "none" : "not-recorded",
      entries: reused ? reusedOf(reused, { quote }) : [],
    },
  }
}

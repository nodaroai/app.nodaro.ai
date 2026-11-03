import { getAuthHeaders } from "@/lib/api"

/**
 * The admin Motion price check's client: the three POSTs of
 * `/v1/admin/motion-price-check`, typed. The wire types mirror the server's
 * (`backend/src/ee/lib/motion-price-check/wire.ts`) exactly; keep them in step.
 *
 * A thin client and nothing more: every figure is the database's, and the
 * page only rounds for display. A failure becomes a `MotionPriceApiError`
 * with the server's code, message and status, so the page can say the
 * server's own sentence (the 503 while the database lacks the functions, the
 * 502 when KIE's logs could not be read).
 *
 * KIE's map (`kieUsd`) is what the KIE route answered, sent back with a runs
 * request only when the admin fetched it; with none the body has no key at
 * all. The dashboard token is sent by `fetchKieReal` alone.
 */

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

/** A request the server answered with a failure: its code and sentence, and the HTTP status. */
export class MotionPriceApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = "MotionPriceApiError"
    this.code = code
    this.status = status
  }
}

/** One page of the range's runs: filters left out are no filter; `flaggedOnly: false` is none either. */
export interface MotionPriceListParams {
  from: string
  to: string
  engine?: MotionEngine
  style?: MotionStyle
  kind?: MotionKind
  resolution?: "480p" | "720p" | "1080p"
  flaggedOnly?: boolean
  sort: MotionSort
  dir: "asc" | "desc"
  offset: number
  limit: number
}

const BASE = "/v1/admin/motion-price-check"

/** The platform's `{ error: { code, message } }`; anything else (a proxy's page, a body that is not JSON) by its status. */
async function failureFrom(res: Response): Promise<MotionPriceApiError> {
  const payload = (await res.json().catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null
  const code = payload?.error?.code
  const message = payload?.error?.message
  return new MotionPriceApiError(
    typeof code === "string" && code !== "" ? code : "http_error",
    typeof message === "string" && message !== "" ? message : `The request failed (HTTP ${res.status}).`,
    res.status,
  )
}

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { ...(await getAuthHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await failureFrom(res)
  return ((await res.json()) as { data: T }).data
}

/** The range's runs, filtered, sorted and paged, with the totals over every filtered run. */
export async function fetchMotionPriceRuns(params: MotionPriceListParams, kieUsd?: Record<string, number>): Promise<MotionPriceList> {
  return post<MotionPriceList>(`${BASE}/runs`, kieUsd === undefined ? { ...params } : { ...params, kieUsd })
}

/** One run, by its id whatever its date: its steps, its quote's lines and what it reused. */
export async function fetchMotionPriceRun(jobId: string, kieUsd?: Record<string, number>): Promise<MotionPriceRunDetail> {
  return post<MotionPriceRunDetail>(`${BASE}/runs/${encodeURIComponent(jobId)}`, kieUsd === undefined ? {} : { kieUsd })
}

/** KIE's own figures for the range's Motion tasks, read with the admin's dashboard token (sent here and nowhere else). */
export async function fetchKieReal(body: { token: string; from: string; to: string }): Promise<KieRealResult> {
  return post<KieRealResult>(`${BASE}/kie-real`, body)
}

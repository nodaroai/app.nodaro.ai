import { getAuthHeaders } from "@/lib/api"

/**
 * The `/v1/admin/review` endpoints, typed — the whole network surface of the
 * Content Review page (spec §8.3).
 *
 * Isolated in a module of its own for one concrete reason: the preview fetches
 * a **Blob**, and a page test that stubbed `fetch` would have to fake a binary
 * response body to render a card at all. Mocking this module instead (the
 * `ee/lib/orgs-api` pattern) keeps the page test about the page.
 *
 * A thin client and nothing more. Every decision — who may resolve, what a
 * conflict means — is the server's; this file owns the shape of the wire and
 * the one place a failure becomes a `ReviewApiError` carrying the code the UI
 * branches on. `review_already_resolved` in particular is NOT a fault: another
 * admin got there first, which the page surfaces as information.
 */

export class ReviewApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = "ReviewApiError"
    this.code = code
    this.status = status
  }
}

export type ReviewMediaKind = "image" | "video" | "audio" | "other"

/** One row of the queue. No URL, no held payload, no provider cost — see the
 *  route's own header for why each of those is absent. */
export interface HeldJobSummary {
  jobId: string
  userId: string | null
  jobType: string | null
  mediaKind: ReviewMediaKind
  outputCount: number
  credits: number
  createdAt: string
  heldAt: string | null
  heldForMinutes: number
  policyId: string | null
  reason: string | null
  source: string | null
  sourceDetail: string | null
}

export interface HeldOutputRef {
  index: number
  mediaKind: ReviewMediaKind
  filename: string
  sizeBytes: number | null
}

export interface HeldJobDetail extends HeldJobSummary {
  /** Raw, for an admin — it can carry the prompt, which is why it is on the
   *  detail route and not on the 25-row queue. */
  inputData: Record<string, unknown> | null
  outputs: HeldOutputRef[]
}

export interface ReviewDecision {
  id: string
  jobId: string | null
  hookPoint: string
  policyId: string
  verdict: string
  reason: string | null
  resolverEmail: string | null
  createdAt: string
}

export interface ReviewPage<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}

async function failureFrom(res: Response): Promise<ReviewApiError> {
  const payload = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
  return new ReviewApiError(
    payload?.error?.code ?? "internal_error",
    payload?.error?.message ?? "Something went wrong",
    res.status,
  )
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers = await getAuthHeaders()
  if (init.body !== undefined) headers["Content-Type"] = "application/json"
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  if (!res.ok) throw await failureFrom(res)
  return (await res.json()) as T
}

function queryString(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue
    qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? `?${s}` : ""
}

export interface HeldJobQuery {
  page?: number
  pageSize?: number
  policyId?: string
  userId?: string
}

export function listHeldJobs(query: HeldJobQuery = {}): Promise<ReviewPage<HeldJobSummary>> {
  return request<ReviewPage<HeldJobSummary>>(`/v1/admin/review/jobs${queryString({ ...query })}`)
}

export async function getHeldJob(jobId: string): Promise<HeldJobDetail> {
  const res = await request<{ data: HeldJobDetail }>(`/v1/admin/review/jobs/${jobId}`)
  return res.data
}

/**
 * The held bytes, through the admin route.
 *
 * `<video src>` and `<img src>` cannot carry a bearer header and this app's
 * auth is header-based, so v1 downloads the object and hands the element an
 * object URL. The cost is real (the whole file arrives before playback, and
 * range requests buy nothing); the alternative — a public URL — would break
 * the one promise a hold makes. The named upgrade is a short-lived HMAC path
 * token in the style of `routes/upload-proxy.ts`, worth building when a
 * reviewer complains about a long video.
 */
export async function fetchHeldOutputBlob(jobId: string, index: number): Promise<Blob> {
  const res = await fetch(`/v1/admin/review/jobs/${jobId}/output/${index}`, {
    headers: await getAuthHeaders(),
  })
  if (!res.ok) throw await failureFrom(res)
  return res.blob()
}

/** `note` is operator-only: it lands on the audit row and never on the job. */
export function approveHeldJob(jobId: string, note?: string): Promise<{ ok: true; jobId: string; status: string }> {
  return request(`/v1/admin/review/jobs/${jobId}/approve`, {
    method: "POST",
    body: note ? { note } : {},
  })
}

/** `reason` is USER-VISIBLE — it becomes the requester's `error_hint.reason`
 *  and lands verbatim on their canvas. The dialog says so. */
export function rejectHeldJob(jobId: string, reason: string): Promise<{ ok: true; jobId: string; status: string }> {
  return request(`/v1/admin/review/jobs/${jobId}/reject`, { method: "POST", body: { reason } })
}

export interface DecisionQuery {
  page?: number
  pageSize?: number
  jobId?: string
  policyId?: string
  verdict?: string
  hookPoint?: string
  since?: string
}

export function listReviewDecisions(query: DecisionQuery = {}): Promise<ReviewPage<ReviewDecision>> {
  return request<ReviewPage<ReviewDecision>>(`/v1/admin/review/decisions${queryString({ ...query })}`)
}

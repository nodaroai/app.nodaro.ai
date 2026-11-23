import { getAuthHeaders } from "@/lib/api"
import type { CastSwapFault, CastSwapFaultSeverity } from "@/lib/api"

/**
 * The admin Remake faults list's client: `GET /v1/admin/remake-faults`,
 * typed. The wire types mirror the server's
 * (`backend/src/ee/routes/admin-remake-faults.ts`); keep them in step.
 *
 * A failure becomes a `RemakeFaultsApiError` with the server's code, message
 * and status, so the page can say the server's own sentence (the 503 while
 * the database lacks the function).
 */

export type RemakeEngine = "prism" | "pulse"

export interface RemakeFaultRun {
  id: string
  createdAt: string
  userId: string
  email: string | null
  jobType: string | null
  status: string
  fullQuality: boolean
  engine: RemakeEngine
  resolution: string | null
  draft: boolean
  /** The worst severity among its faults. */
  worst: CastSwapFaultSeverity
  /** Worst first: blocked, recovered, warning; then by when. */
  faults: CastSwapFault[]
}

export interface RemakeFaultList {
  /** The runs matching every filter, before paging. */
  total: number
  /** The fault kinds of the range's runs (the engine filter applied, not the severity or kind one), sorted. */
  kinds: string[]
  runs: RemakeFaultRun[]
}

/** One page of faulted runs: filters left out are no filter. */
export interface RemakeFaultListParams {
  from: string
  to: string
  severity?: CastSwapFaultSeverity
  kind?: string
  engine?: RemakeEngine
  offset: number
  limit: number
}

/** A request the server answered with a failure: its code and sentence, and the HTTP status. */
export class RemakeFaultsApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = "RemakeFaultsApiError"
    this.code = code
    this.status = status
  }
}

/** The platform's `{ error: { code, message } }`; anything else (a proxy's page, a body that is not JSON) by its status. */
async function failureFrom(res: Response): Promise<RemakeFaultsApiError> {
  const payload = (await res.json().catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null
  const code = payload?.error?.code
  const message = payload?.error?.message
  return new RemakeFaultsApiError(
    typeof code === "string" && code !== "" ? code : "http_error",
    typeof message === "string" && message !== "" ? message : `The request failed (HTTP ${res.status}).`,
    res.status,
  )
}

/** The query string of a page: a filter left out is no key at all. */
export function remakeFaultsQueryOf(params: RemakeFaultListParams): string {
  const q = new URLSearchParams({ from: params.from, to: params.to })
  if (params.severity !== undefined) q.set("severity", params.severity)
  if (params.kind !== undefined) q.set("kind", params.kind)
  if (params.engine !== undefined) q.set("engine", params.engine)
  q.set("offset", String(params.offset))
  q.set("limit", String(params.limit))
  return q.toString()
}

/** A page of the range's faulted Video Remake runs, newest first. */
export async function fetchRemakeFaults(params: RemakeFaultListParams): Promise<RemakeFaultList> {
  const res = await fetch(`/v1/admin/remake-faults?${remakeFaultsQueryOf(params)}`, { headers: await getAuthHeaders() })
  if (!res.ok) throw await failureFrom(res)
  return ((await res.json()) as { data: RemakeFaultList }).data
}

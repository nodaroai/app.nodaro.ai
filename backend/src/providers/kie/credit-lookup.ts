/**
 * KIE.ai Credit Lookup
 *
 * Calls the undocumented KIE dashboard endpoints to get actual credits consumed
 * per task. Used for batch pricing audit to detect mismatches between
 * our hardcoded costs and what KIE actually charges.
 *
 * Two endpoint families:
 * 1. Generic: POST /api/v1/playground/pageRecordListByDoris — most models
 * 2. Model-specific: POST /client/v1/userRecord/{type}/page — suno, gpt-4o image,
 *    flux kontext, veo, midjourney, runway aleph, luma modify, runway
 *
 * Requires:
 * - KIE_UNIQUE_ID env var (constant per account)
 * - Session authorization token (changes per session, entered via admin UI)
 */

import { config } from "../../lib/config.js"

const KIE_BASE = "https://api.kie.ai"
const KIE_GENERIC_URL = `${KIE_BASE}/api/v1/playground/pageRecordListByDoris`
const KIE_USER_RECORD_URL = `${KIE_BASE}/client/v1/userRecord`

export interface KieLogRecord {
  taskId: string
  consumeCredits: number
  remainedCredits: number
  model: string
  state: string
  param?: string
  createTime: number
  completeTime: number
  costTime: number
  /** Which endpoint this record came from (for debugging) */
  _source?: string
}

/** Model-specific record endpoints that KIE uses for certain providers */
interface UserRecordEndpoint {
  /** URL path segment: /client/v1/userRecord/{slug}/page */
  slug: string
  /** Human-readable label for the source */
  label: string
  /** Extra body fields (e.g., VEO needs { model: "generate" }) */
  extraBody?: Record<string, unknown>
}

const USER_RECORD_ENDPOINTS: UserRecordEndpoint[] = [
  { slug: "suno-record", label: "suno" },
  { slug: "gpt4o-image-record", label: "gpt-4o-image" },
  { slug: "flux-kontext-record", label: "flux-kontext" },
  { slug: "veo-record", label: "veo", extraBody: { model: "generate" } },
  { slug: "mj", label: "midjourney" },
  { slug: "aleph", label: "runway-aleph" },
  { slug: "modify", label: "luma-modify" },
  { slug: "runway-record", label: "runway" },
]

/**
 * Common headers for KIE audit requests.
 */
function auditHeaders(sessionToken: string, uniqueId: string) {
  return {
    "Content-Type": "application/json",
    "authorization": sessionToken,
    "uniqueid": uniqueId,
  }
}

/**
 * Generic paginated fetcher. Works for both endpoint families since
 * they share the same request/response shape.
 */
async function fetchPaginated(
  url: string,
  sessionToken: string,
  uniqueId: string,
  beginTime: number,
  endTime: number,
  sourceLabel: string,
  extraBody?: Record<string, unknown>,
): Promise<KieLogRecord[]> {
  const records: KieLogRecord[] = []

  for (let page = 1; page <= 100; page++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: auditHeaders(sessionToken, uniqueId),
        body: JSON.stringify({
          pageNum: page,
          pageSize: 50,
          beginTime,
          endTime,
          ...extraBody,
        }),
        signal: AbortSignal.timeout(30_000),
      })

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("KIE session token expired — get a new one from kie.ai/logs Network tab (authorization header)")
        }
        throw new Error(`KIE API error: ${response.status}`)
      }

      const data = await response.json() as {
        code: number
        data?: { records?: KieLogRecord[]; pages?: number }
      }

      if (data.code === 401) {
        throw new Error("KIE session token expired — get a new one from kie.ai/logs Network tab (authorization header)")
      }

      if (data.code !== 200 || !data.data?.records?.length) break

      for (const r of data.data.records) {
        records.push({ ...r, _source: sourceLabel })
      }

      if (page >= (data.data.pages ?? 0)) break
    } catch (err) {
      if (page === 1) throw err
      break
    }
  }

  return records
}

/**
 * Fetch KIE log records from the generic (legacy) endpoint only.
 * Kept for backward compatibility.
 */
export async function fetchKieLogs(
  sessionToken: string,
  beginTime: number,
  endTime: number,
): Promise<KieLogRecord[]> {
  const uniqueId = config.KIE_UNIQUE_ID
  if (!uniqueId) {
    throw new Error("KIE_UNIQUE_ID env var not configured")
  }

  return fetchPaginated(
    KIE_GENERIC_URL, sessionToken, uniqueId,
    beginTime, endTime, "generic",
    { successFlag: "" },
  )
}

/**
 * Fetch KIE log records from ALL endpoints (generic + model-specific).
 * Deduplicates by taskId. Returns combined results with _source tags.
 */
export async function fetchAllKieLogs(
  sessionToken: string,
  beginTime: number,
  endTime: number,
): Promise<{ records: KieLogRecord[]; sources: Record<string, number> }> {
  const uniqueId = config.KIE_UNIQUE_ID
  if (!uniqueId) {
    throw new Error("KIE_UNIQUE_ID env var not configured")
  }

  // Fetch ALL endpoints in parallel (generic + model-specific)
  const allFetches = await Promise.allSettled([
    fetchPaginated(
      KIE_GENERIC_URL, sessionToken, uniqueId,
      beginTime, endTime, "generic",
      { successFlag: "" },
    ),
    ...USER_RECORD_ENDPOINTS.map(ep =>
      fetchPaginated(
        `${KIE_USER_RECORD_URL}/${ep.slug}/page`,
        sessionToken, uniqueId,
        beginTime, endTime, ep.label,
        ep.extraBody,
      ),
    ),
  ])

  // Combine and deduplicate by taskId
  const seen = new Set<string>()
  const allRecords: KieLogRecord[] = []
  const sources: Record<string, number> = {}

  for (const result of allFetches) {
    if (result.status !== "fulfilled") continue
    for (const r of result.value) {
      const key = r.taskId
      if (key && seen.has(key)) continue
      if (key) seen.add(key)
      allRecords.push(r)
      const src = r._source ?? "unknown"
      sources[src] = (sources[src] ?? 0) + 1
    }
  }

  // If nothing succeeded at all, check if it was an auth error
  if (allRecords.length === 0) {
    const firstError = allFetches.find(r => r.status === "rejected")
    if (firstError?.status === "rejected") throw firstError.reason
  }

  return { records: allRecords, sources }
}

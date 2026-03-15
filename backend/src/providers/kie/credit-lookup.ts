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
 * The two families return different response shapes:
 * - Generic: { code, data: { records: [...], pages } }  fields: taskId, consumeCredits, model, state
 * - Model-specific: { code, data: { records: [...], pages } }  fields vary: id/taskId, credits/consumeCredits, status/state, modelName/model
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
  /** Full path after /client/v1/userRecord/ (e.g., "suno-record/page" or "getLyricsRecords") */
  path: string
  /** Human-readable label for the source */
  label: string
  /** Extra body fields (e.g., VEO needs { model: "generate" }) */
  extraBody?: Record<string, unknown>
}

const USER_RECORD_ENDPOINTS: UserRecordEndpoint[] = [
  // Image
  { path: "gpt4o-image-record/page", label: "gpt-4o-image" },
  { path: "flux-kontext-record/page", label: "flux-kontext" },
  { path: "mj/page", label: "midjourney" },
  // Video
  { path: "veo-record/page", label: "veo-generate", extraBody: { model: "generate" } },
  { path: "veo/page", label: "veo-extend", extraBody: { model: "extend" } },
  { path: "veo/page", label: "veo-4k", extraBody: { model: "video4k" } },
  { path: "veo1080p/page", label: "veo-1080p", extraBody: { model: "video1080p" } },
  { path: "aleph/page", label: "runway-aleph" },
  { path: "modify/page", label: "luma-modify" },
  { path: "runway-record/page", label: "runway" },
  // Suno music
  { path: "suno-record/page", label: "suno-audio" },
  { path: "getLyricsRecords", label: "suno-lyrics" },
  { path: "getSubtitleRecords", label: "suno-subtitle" },
  { path: "wav/page", label: "suno-wav" },
  { path: "vocal-removal/page", label: "suno-vocal-removal" },
  { path: "mp4/page", label: "suno-lyrics-video" },
  { path: "midi/page", label: "suno-midi" },
  { path: "persona/page", label: "suno-persona" },
  { path: "style/page", label: "suno-style" },
  { path: "cover/page", label: "suno-cover" },
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
 * Normalize a raw record from any KIE endpoint into our standard KieLogRecord.
 *
 * Generic endpoint fields:   taskId, consumeCredits, remainedCredits, model, state, param, createTime, completeTime, costTime
 * Model-specific fields:     uuid, creditsConsumed, creditsRemaining, type, successFlag (200=ok), paramJson, createTime, operationType
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRecord(raw: any, sourceLabel: string): KieLogRecord {
  // successFlag: 200 = success, anything else = failed
  let state = raw.state ?? ""
  if (!state && raw.successFlag !== undefined) {
    state = raw.successFlag === 200 ? "success" : "fail"
  }

  return {
    taskId: raw.taskId ?? raw.uuid ?? raw.task_id ?? raw.id?.toString() ?? "",
    consumeCredits: raw.consumeCredits ?? raw.creditsConsumed ?? raw.credits_consumed ?? raw.credits ?? 0,
    remainedCredits: raw.remainedCredits ?? raw.creditsRemaining ?? raw.credits_remaining ?? 0,
    model: raw.model ?? raw.type ?? raw.modelName ?? raw.model_name ?? sourceLabel,
    state,
    param: raw.param ?? raw.paramJson ?? raw.params ?? undefined,
    createTime: raw.createTime ?? raw.create_time ?? 0,
    completeTime: raw.completeTime ?? raw.complete_time ?? 0,
    costTime: raw.costTime ?? raw.cost_time ?? 0,
    _source: sourceLabel,
  }
}

interface FetchResult {
  records: KieLogRecord[]
  error?: string
  /** First page raw response sample (for debugging unknown formats) */
  rawSample?: unknown
}

/**
 * Paginated fetcher that handles both endpoint families.
 * Normalizes records from any response shape.
 */
async function fetchPaginated(
  url: string,
  sessionToken: string,
  uniqueId: string,
  beginTime: number,
  endTime: number,
  sourceLabel: string,
  extraBody?: Record<string, unknown>,
): Promise<FetchResult> {
  const records: KieLogRecord[] = []
  let rawSample: unknown

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
          return { records, error: "401 — session token expired" }
        }
        return { records, error: `HTTP ${response.status}` }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await response.json() as any

      // Save first page raw response for debugging
      if (page === 1) {
        try {
          const sample = JSON.parse(JSON.stringify(data))
          // Truncate records array to first item for sample
          if (sample?.data?.records?.length > 1) {
            sample.data.records = [sample.data.records[0]]
            sample.data._recordsTruncated = true
          }
          rawSample = sample
        } catch { /* ignore */ }
      }

      if (data.code === 401) {
        return { records, error: "code 401 — session token expired" }
      }

      // Try multiple possible response shapes
      // Shape 1 (generic): { code: 200, data: { records: [...], pages: N } }
      // Shape 2 (some model endpoints): { code: 0, data: { records: [...], pages: N } }
      // Shape 3: { success: true, data: { list: [...], total: N } }
      const isOk = data.code === 200 || data.code === 0 || data.success === true
      if (!isOk) {
        if (page === 1) return { records, error: `Unexpected code: ${data.code ?? data.status ?? "unknown"}`, rawSample }
        break
      }

      const rawRecords: unknown[] =
        data.data?.records ??
        data.data?.list ??
        data.records ??
        data.data ??
        []

      if (!Array.isArray(rawRecords) || rawRecords.length === 0) break

      for (const raw of rawRecords) {
        records.push(normalizeRecord(raw, sourceLabel))
      }

      const totalPages = data.data?.pages ?? data.data?.totalPages ?? Math.ceil((data.data?.total ?? 0) / 50) ?? 0
      if (page >= totalPages) break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (page === 1) return { records, error: msg, rawSample }
      break
    }
  }

  return { records, rawSample }
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

  const result = await fetchPaginated(
    KIE_GENERIC_URL, sessionToken, uniqueId,
    beginTime, endTime, "generic",
    { successFlag: "" },
  )
  if (result.error && result.records.length === 0) {
    throw new Error(result.error)
  }
  return result.records
}

export interface FetchAllResult {
  records: KieLogRecord[]
  sources: Record<string, number>
  errors: Record<string, string>
  /** First-page raw response samples per endpoint (for debugging) */
  rawSamples: Record<string, unknown>
}

/**
 * Fetch KIE log records from ALL endpoints (generic + model-specific).
 * Deduplicates by taskId. Returns combined results with _source tags
 * and per-endpoint error reporting.
 */
export async function fetchAllKieLogs(
  sessionToken: string,
  beginTime: number,
  endTime: number,
): Promise<FetchAllResult> {
  const uniqueId = config.KIE_UNIQUE_ID
  if (!uniqueId) {
    throw new Error("KIE_UNIQUE_ID env var not configured")
  }

  const endpointLabels = ["generic", ...USER_RECORD_ENDPOINTS.map(ep => ep.label)]

  // Fetch ALL endpoints in parallel (generic + model-specific)
  const allFetches = await Promise.allSettled([
    fetchPaginated(
      KIE_GENERIC_URL, sessionToken, uniqueId,
      beginTime, endTime, "generic",
      { successFlag: "" },
    ),
    ...USER_RECORD_ENDPOINTS.map(ep =>
      fetchPaginated(
        `${KIE_USER_RECORD_URL}/${ep.path}`,
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
  const errors: Record<string, string> = {}
  const rawSamples: Record<string, unknown> = {}

  for (let i = 0; i < allFetches.length; i++) {
    const label = endpointLabels[i]
    const result = allFetches[i]

    if (result.status === "rejected") {
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason)
      errors[label] = msg
      continue
    }

    const { records, error, rawSample } = result.value
    if (error) errors[label] = error
    if (rawSample) rawSamples[label] = rawSample

    for (const r of records) {
      const key = r.taskId
      if (key && seen.has(key)) continue
      if (key) seen.add(key)
      allRecords.push(r)
      sources[label] = (sources[label] ?? 0) + 1
    }
  }

  return { records: allRecords, sources, errors, rawSamples }
}

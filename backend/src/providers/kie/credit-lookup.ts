/**
 * KIE.ai Credit Lookup
 *
 * Calls the undocumented KIE dashboard endpoint to get actual credits consumed
 * per task. Used for batch pricing audit to detect mismatches between
 * our hardcoded costs and what KIE actually charges.
 *
 * Requires:
 * - KIE_UNIQUE_ID env var (constant per account)
 * - Session authorization token (changes per session, entered via admin UI)
 */

import { config } from "../../lib/config.js"

const KIE_AUDIT_URL = "https://api.kie.ai/api/v1/playground/pageRecordListByDoris"

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
}

/**
 * Fetch all KIE log records for a given time window.
 * Pages through all results automatically.
 * @param sessionToken - Authorization header value from kie.ai session (entered by admin)
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

  const allRecords: KieLogRecord[] = []

  for (let page = 1; page <= 100; page++) {
    try {
      const response = await fetch(KIE_AUDIT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "authorization": sessionToken,
          "uniqueid": uniqueId,
        },
        body: JSON.stringify({
          pageNum: page,
          pageSize: 50,
          beginTime,
          endTime,
          successFlag: "",
        }),
        signal: AbortSignal.timeout(15_000),
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

      if (data.code !== 200 || !data.data?.records) break

      allRecords.push(...data.data.records)

      // No more pages
      if (page >= (data.data.pages ?? 0)) break
    } catch (err) {
      if (page === 1) throw err // First page failure = auth issue, rethrow
      break // Later pages = just stop paginating
    }
  }

  return allRecords
}

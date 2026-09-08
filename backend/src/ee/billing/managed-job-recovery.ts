import { hasCredits } from "../../lib/config.js"
import { supabase } from "../../lib/supabase.js"
import { CreditsService } from "./credits.js"

const BATCH_SIZE = 100
let afterId: string | undefined
let running = false

/** Recover a crash between terminal status and settlement without rerunning work.
 * Cross-tenant service maintenance; the RPC locks and verifies each owned pair.
 * Keyset rotation prevents an invalid checkpoint from starving later holds.
 */
export async function recoverManagedJobSettlements(): Promise<{ scanned: number; recovered: number; errors: number }> {
  const result = { scanned: 0, recovered: 0, errors: 0 }
  if (!hasCredits() || running) return result
  running = true
  try {
    let query = supabase.from("usage_logs")
      .select("id, jobs!usage_logs_job_id_fkey!inner(status)")
      .eq("status", "reserved").eq("metadata->>reservation_mode", "job-once")
      .in("jobs.status", ["completed", "failed", "cancelled"])
      .order("id", { ascending: true }).limit(BATCH_SIZE)
    if (afterId) query = query.gt("id", afterId)
    const { data, error } = await query
    if (error) throw new Error(`Managed settlement recovery scan failed: ${error.message}`)
    const rows = (data ?? []) as unknown as { id: string }[]
    result.scanned = rows.length
    for (const row of rows) {
      try {
        if (await CreditsService.trySettleManagedCredits(row.id)) result.recovered++
      } catch (error) {
        result.errors++
        console.warn(`[managed-settlement] recovery failed for ${row.id}:`, error)
      }
    }
    afterId = rows.length === BATCH_SIZE ? rows.at(-1)!.id : undefined
    return result
  } finally { running = false }
}

/**
 * Sweep stale dynamic-client registrations (RFC 7591 DCR).
 *
 * `POST /v1/oauth/register` mints a `developer_apps` row for every MCP client
 * and community instance that starts a connection. The ones nobody ever
 * consented to are dead weight: an aborted consent window, a smoke run, a
 * Connect click on an install that was reset before the flow finished. They
 * used to accumulate forever; the open-registration cap only counted the last
 * 24 h of them (#708).
 *
 * TWO conditions, and the second is load-bearing:
 *
 *  1. `owner_user_id IS NULL` — nobody claimed it at consent.
 *  2. **No `developer_app_authorizations` row points at it.** `app_id`
 *     cascades on delete, all the way to `developer_app_tokens`, so deleting
 *     an app row with a live authorization silently kills a working client's
 *     access. Condition 1 alone is NOT a safe proxy for "never consented":
 *     the claim in `routes/oauth.ts` is best-effort (a transient DB error
 *     leaves a consented row unclaimed), and every community_instance row
 *     created before that claim existed is unclaimed BY CONSTRUCTION —
 *     3 of them on production the day this shipped, each a live connection.
 *     Migration 323 backfills those, but a sweep that runs before the
 *     migration lands, or after any future claim failure, would disconnect
 *     real installs. So the sweep asks the authorizations table directly and
 *     never depends on the claim having worked.
 */
import { supabase } from "./supabase.js"

export const STALE_DCR_REGISTRATION_AGE_MS = 24 * 60 * 60 * 1000

/** Bounds one pass; the cron runs hourly, so a backlog drains quickly. */
const SWEEP_BATCH = 500

export async function sweepStaleDcrRegistrations(now = Date.now()): Promise<{ deleted: number; keptAuthorized: number }> {
  const cutoff = new Date(now - STALE_DCR_REGISTRATION_AGE_MS).toISOString()

  const { data: candidates, error: findError } = await supabase
    .from("developer_apps")
    .select("id")
    .in("kind", ["dynamic_mcp", "community_instance"])
    .is("owner_user_id", null)
    .lt("created_at", cutoff)
    .limit(SWEEP_BATCH)
  if (findError) throw new Error(`stale DCR sweep failed: ${findError.message}`)
  const ids = (candidates ?? []).map((r) => r.id as string)
  if (ids.length === 0) return { deleted: 0, keptAuthorized: 0 }

  // Anything anyone ever consented to stays, claimed or not.
  const { data: authorized, error: authError } = await supabase
    .from("developer_app_authorizations")
    .select("app_id")
    .in("app_id", ids)
  if (authError) throw new Error(`stale DCR sweep failed: ${authError.message}`)
  const keep = new Set((authorized ?? []).map((r) => r.app_id as string))
  const deletable = ids.filter((id) => !keep.has(id))
  if (deletable.length === 0) return { deleted: 0, keptAuthorized: keep.size }

  const { data: deleted, error: delError } = await supabase
    .from("developer_apps")
    .delete()
    .in("id", deletable)
    .select("id")
  if (delError) throw new Error(`stale DCR sweep failed: ${delError.message}`)
  return { deleted: deleted?.length ?? 0, keptAuthorized: keep.size }
}

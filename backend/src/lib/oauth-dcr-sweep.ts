/**
 * Sweep stale dynamic-client registrations (RFC 7591 DCR).
 *
 * `POST /v1/oauth/register` mints a `developer_apps` row for every MCP client
 * and community instance that starts a connection. The ones nobody ever
 * consented to (`owner_user_id IS NULL`) are dead weight: an aborted consent
 * window, a smoke run, a Connect click on an install that was reset before
 * the flow finished. They used to accumulate forever; the open-registration
 * cap only counted the last 24 h of them (#708).
 *
 * A row is stale once it is older than the cap's own window: after that it no
 * longer counts against anyone and can never be consented to (the install
 * has long re-registered). Deleting is safe — nothing references an
 * unconsented DCR row (authorizations only exist after consent).
 */
import { supabase } from "./supabase.js"

export const STALE_DCR_REGISTRATION_AGE_MS = 24 * 60 * 60 * 1000

export async function sweepStaleDcrRegistrations(now = Date.now()): Promise<{ deleted: number }> {
  const cutoff = new Date(now - STALE_DCR_REGISTRATION_AGE_MS).toISOString()
  const { data, error } = await supabase
    .from("developer_apps")
    .delete()
    .in("kind", ["dynamic_mcp", "community_instance"])
    .is("owner_user_id", null)
    .lt("created_at", cutoff)
    .select("id")
  if (error) throw new Error(`stale DCR sweep failed: ${error.message}`)
  return { deleted: data?.length ?? 0 }
}

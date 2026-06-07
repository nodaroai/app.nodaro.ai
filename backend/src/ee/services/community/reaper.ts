import { supabase } from "../../../lib/supabase.js"
import { purgeCommunityListingBlobs } from "./asset-lifecycle.js"

const GRACE_DAYS = Number(process.env.COMMUNITY_REAPER_GRACE_DAYS ?? "7")
const INTERVAL_MS = 6 * 60 * 60 * 1000

export async function sweepOrphanedCommunityBlobs(graceDays = GRACE_DAYS): Promise<void> {
  const cutoff = new Date(Date.now() - graceDays * 86_400_000).toISOString()
  const { data } = await supabase
    .from("community_listings")
    .select("id")
    .eq("is_active", false)
    .lt("updated_at", cutoff)
    .limit(100)
  const rows = (data ?? []) as Array<{ id: string }>
  for (const r of rows) await purgeCommunityListingBlobs(r.id)
  if (rows.length) await supabase.from("community_listings").delete().in("id", rows.map((r) => r.id))
}

export function startCommunityReaperCron(): void {
  void sweepOrphanedCommunityBlobs().catch((e) => console.error("[community-reaper]", e))
  setInterval(() => void sweepOrphanedCommunityBlobs().catch((e) => console.error("[community-reaper]", e)), INTERVAL_MS)
}

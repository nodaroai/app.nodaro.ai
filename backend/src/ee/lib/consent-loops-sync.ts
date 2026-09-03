import { supabase } from "../../lib/supabase.js"
import { updateContact, isLoopsConfigured } from "./loops-client.js"
import { firstNameFrom } from "./recipient-first-name.js"

const CONSENT_KIND = "marketing_email"

// After this many consecutive failed pushes, give up on a row (clear its dirty
// flag) rather than retrying it every sweep forever.
const MAX_SYNC_ATTEMPTS = 5

interface ConsentRow {
  status: string
  granted_at: string | null
  source_app: string | null
  loops_sync_attempts: number | null
}

/**
 * Reconcile ONE consent row into Loops. Best-effort and never throws: on
 * success it clears `loops_dirty` + stamps `loops_synced_at`; on failure it
 * records `loops_sync_status = 'error'` and leaves the row dirty so the sweep
 * retries. A Loops outage must never break the consent write it mirrors.
 *
 * Only users who have EVER granted get a Loops contact — a decline/stop that
 * never granted has nothing to push, so we just clear the flag.
 */
export async function syncConsentRow(userId: string, kind: string = CONSENT_KIND): Promise<void> {
  if (!isLoopsConfigured()) return // dormant until LOOPS_API_KEY is set

  const { data: row } = await supabase
    .from("user_consents")
    .select("status, granted_at, source_app, loops_sync_attempts")
    .eq("user_id", userId)
    .eq("kind", kind)
    .maybeSingle()
  if (!row) return
  const c = row as ConsentRow

  if (!c.granted_at) {
    // Never had a Loops contact — nothing to mirror.
    await clearDirty(userId, kind, "synced")
    return
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("id", userId)
    .maybeSingle()
  const email = ((profile?.email as string | undefined) ?? "").trim()
  if (!email) {
    await clearDirty(userId, kind, "error")
    return
  }
  const firstName = firstNameFrom(profile?.full_name as string | null | undefined)

  const result = await updateContact(email, {
    firstName,
    subscribed: c.status === "granted",
    userId,
    source: c.source_app ?? undefined,
  })

  const nowIso = new Date().toISOString()
  if (result.ok) {
    await supabase
      .from("user_consents")
      .update({ loops_dirty: false, loops_synced_at: nowIso, loops_sync_status: "synced", loops_sync_attempts: 0, updated_at: nowIso })
      .eq("user_id", userId)
      .eq("kind", kind)
  } else {
    // Cap retries: after MAX_SYNC_ATTEMPTS failures, give up (clear loops_dirty)
    // and leave the row visibly 'error' rather than retrying it forever.
    const attempts = (c.loops_sync_attempts ?? 0) + 1
    const giveUp = attempts >= MAX_SYNC_ATTEMPTS
    await supabase
      .from("user_consents")
      .update({ loops_sync_status: "error", loops_sync_attempts: attempts, loops_dirty: !giveUp, updated_at: nowIso })
      .eq("user_id", userId)
      .eq("kind", kind)
  }
}

async function clearDirty(userId: string, kind: string, status: "synced" | "error"): Promise<void> {
  await supabase
    .from("user_consents")
    .update({ loops_dirty: false, loops_sync_status: status, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("kind", kind)
}

/**
 * Backfill sweep — reconcile every row whose Loops state is stale. Runs on the
 * Cloud-only cleanup cron. Returns how many rows it pushed.
 */
export async function sweepUnsyncedConsents(limit = 200): Promise<number> {
  if (!isLoopsConfigured()) return 0
  const { data, error } = await supabase
    .from("user_consents")
    .select("user_id, kind")
    .eq("loops_dirty", true)
    .limit(limit)
  if (error || !data) return 0

  const rows = data as Array<{ user_id: string; kind: string }>
  // Bounded concurrency so a Loops outage can't turn the hourly sweep into a
  // long serial stall (up to `limit` rows x the per-call timeout).
  const CONCURRENCY = 5
  let synced = 0
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY)
    await Promise.all(
      chunk.map((r) =>
        syncConsentRow(r.user_id, r.kind)
          .then(() => {
            synced++
          })
          .catch(() => {
            // syncConsentRow already swallows its own errors; guard the loop.
          }),
      ),
    )
  }
  return synced
}

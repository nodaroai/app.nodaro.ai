import { socialPublishQueue } from "./social-queue.js"
import { supabase } from "./supabase.js"

/**
 * 60s scanner for due scheduled posts — sibling of `schedule-cron.ts`
 * (workflow triggers), same in-server lifecycle.
 *
 * Multi-instance safety: each due row is CLAIMED with a CAS update
 * (`queued -> publishing` guarded by `status = 'queued'`) BEFORE enqueue, so
 * two server instances scanning simultaneously can never double-enqueue. If
 * the enqueue itself fails, the claim is reverted so the next tick retries —
 * fail-closed (a post publishes late, never twice).
 */

const SCAN_INTERVAL_MS = 60_000
const BATCH_LIMIT = 20

let intervalId: ReturnType<typeof setInterval> | null = null

export async function scanDueScheduledPosts(): Promise<number> {
  const { data: due, error } = await supabase
    .from("scheduled_posts")
    .select("id")
    .eq("status", "queued")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(BATCH_LIMIT)

  if (error || !due?.length) return 0

  let enqueued = 0
  for (const row of due as Array<{ id: string }>) {
    // Claim: only ONE instance wins the queued->publishing transition.
    const { data: claimed } = await supabase
      .from("scheduled_posts")
      .update({ status: "publishing", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "queued")
      .select("id")

    if (!claimed?.length) continue // another instance won, or the row changed

    try {
      await socialPublishQueue.add("publish", { scheduledPostId: row.id })
      enqueued++
    } catch (err) {
      // Revert the claim so the next tick retries — never lose the post.
      await supabase
        .from("scheduled_posts")
        .update({ status: "queued", updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "publishing")
      console.error(`[scheduled-posts] enqueue failed for ${row.id}:`, err)
    }
  }
  return enqueued
}

export function startScheduledPostsCron(): void {
  if (intervalId) return
  intervalId = setInterval(() => {
    scanDueScheduledPosts().catch((err) =>
      console.error("[scheduled-posts] scan failed:", err),
    )
  }, SCAN_INTERVAL_MS)
  console.log("[scheduled-posts] cron started (60s)")
}

export function stopScheduledPostsCron(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

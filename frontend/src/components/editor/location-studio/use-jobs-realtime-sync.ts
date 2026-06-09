/**
 * Subscribes to Supabase Realtime UPDATE events on the `jobs` table for
 * the current user and invokes a caller-supplied handler when a tracked
 * job updates.
 *
 * Why a per-user filter with a per-INSTANCE channel topic
 * -------------------------------------------------------
 * The Location Studio commonly tracks 1-4 candidate-generation jobs at
 * once, and any tab the user has open might track a different set of
 * jobs. A per-job channel would scale poorly (one CDC subscription per
 * pending job). Instead each hook instance opens one channel filtered by
 * `user_id=eq.<userId>` and drops events whose job id isn't in the
 * caller's tracked-set ref. RLS already restricts the per-user filter
 * so the broadcast cost is bounded by the user's own activity.
 *
 * The channel TOPIC must be unique per hook instance (`jobs:<userId>:<n>`),
 * not shared per user. supabase-js (realtime-js ≥2.105) dedupes
 * `client.channel(name)` by topic — a second caller gets the FIRST
 * caller's channel instance back, and `.on("postgres_changes", …)` throws
 * once that instance is subscribed. Multiple consumers of this hook DO
 * mount concurrently for the same user (the studio modal's sheet-tab jobs
 * hook + the active tab's own jobs hook), which crashed the studio on
 * open. A unique suffix gives every consumer an independent channel, so
 * any number of concurrent mounts (and rapid unmount/remount cycles,
 * where async channel teardown could otherwise hand back a dying
 * instance) stay correct by default. Delivery is defined by the
 * `postgres_changes` filter, not the topic, so events are unaffected;
 * the cost is one extra CDC subscription per concurrently-open consumer
 * (bounded: 2-3 while a studio is open).
 *
 * Replacement for polling
 * -----------------------
 * Phase 2 #12 replaces the primary signal in `use-location-studio-jobs.ts`
 * with this realtime hook. The existing 2s polling stays as a fallback
 * (throttled to 10s) for clients where realtime drops, RLS edge cases
 * occur, or the connection is offline — the polling tick remains the
 * authoritative recovery path. Each event from this hook simply causes
 * the same `onJobUpdate` handler to fire sooner than the polling tick
 * would have.
 *
 * Stale-closure prevention
 * ------------------------
 * Both `onJobUpdate` and `trackedJobIds` are stashed in refs that are
 * refreshed every render. The subscribe-effect captures only `userId`
 * (the channel scope) — so callers can mutate the tracked-set or swap
 * handlers without forcing the channel to be torn down and reopened.
 *
 * Migration
 * ---------
 * supabase/migrations/136_locations_jobs_realtime.sql adds:
 *   ALTER TABLE jobs REPLICA IDENTITY FULL;
 *   ALTER PUBLICATION supabase_realtime ADD TABLE jobs;
 * REPLICA IDENTITY FULL is required so unchanged-TOAST values like the
 * `output_data` JSONB column are emitted in the UPDATE WAL payload —
 * without it, a worker updating only `status` would produce an event
 * whose payload omits `output_data` and the studio would see no URL.
 */
import { useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase"

/**
 * Monotonic counter making every subscribe-effect run use a fresh channel
 * topic. See "Why a per-user filter with a per-INSTANCE channel topic" above.
 */
let channelSeq = 0

/**
 * Raw shape of a `jobs` row as it arrives from Postgres replication
 * (snake_case columns from the underlying table). Only the columns the
 * studio's polling consumer reads are listed; extra columns in the WAL
 * payload are ignored.
 *
 * `output_data` is `unknown` because the worker writes provider-specific
 * shapes there (imageUrl for image jobs, videoUrl for video jobs, etc.)
 * — the consumer narrows it the same way the polling code already does.
 */
export interface JobRealtimeRow {
  readonly id: string
  readonly status: string
  readonly user_id: string | null
  readonly output_data: unknown
}

/**
 * Subscribes to Realtime UPDATE events on `jobs` filtered by user_id.
 * Events for jobs not in `trackedJobIds` are dropped before the
 * `onJobUpdate` handler is invoked.
 *
 * @param userId — The current user's id. When null/undefined the hook
 *   is a no-op (no channel is opened). Changing the id tears down the
 *   existing subscription and opens a fresh one.
 * @param trackedJobIds — Set of job ids the caller is currently
 *   interested in. Read fresh from a ref on every event, so the caller
 *   can mutate this set without forcing channel re-creation.
 * @param onJobUpdate — Called with the job row payload when an UPDATE
 *   event arrives for a tracked job. The caller is responsible for
 *   reacting to terminal statuses (`completed` / `failed`).
 */
export function useJobsRealtimeSync(
  userId: string | null | undefined,
  trackedJobIds: ReadonlySet<string>,
  onJobUpdate: (job: JobRealtimeRow) => void,
): void {
  const cbRef = useRef(onJobUpdate)
  cbRef.current = onJobUpdate
  const trackedRef = useRef(trackedJobIds)
  trackedRef.current = trackedJobIds

  useEffect(() => {
    if (!userId) return

    const supabase = createClient()
    channelSeq += 1
    const channelName = `jobs:${userId}:${channelSeq}`

    const channel = supabase
      .channel(channelName)
      .on(
        // Cast through unknown — see useLocationRealtimeSync for context.
        "postgres_changes" as never,
        {
          event: "UPDATE",
          schema: "public",
          table: "jobs",
          filter: `user_id=eq.${userId}`,
        },
        (payload: { new: JobRealtimeRow | null }) => {
          const next = payload.new
          if (!next) return
          if (!trackedRef.current.has(next.id)) return
          cbRef.current(next)
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId])
}

/**
 * Subscribes to Supabase Realtime UPDATE events on the currently-open
 * `creatures` row and invokes a caller-supplied callback with the new row.
 *
 * Why it exists
 * -------------
 * Workers writing back into a creature row (asset auto-attach when an
 * image-generation job completes, source_image_url set by approve-main-image
 * via the worker path) need to surface their changes to the Creature Studio
 * without the user closing/reopening the modal or hitting Save. Mirrors the
 * object-studio realtime hook (use-object-realtime-sync.ts) with object →
 * creature substitution — the badge on the canvas and the asset grids inside
 * the studio refresh instantly when a worker writes to one of the JSONB
 * bucket columns (angles, poses, variations, motion_clips, reference_photos).
 *
 * Subscription scope
 * ------------------
 * The Postgres CDC filter (`id=eq.<creatureId>`) restricts events to the
 * single creature row currently open in the studio. RLS continues to apply
 * on Realtime — Supabase enforces the same user_id-scoped policies on the
 * broadcast filter so the user only receives events for rows they can
 * SELECT.
 *
 * Stale-closure prevention
 * ------------------------
 * The `onUpdate` callback is stashed in a ref that's refreshed on every
 * render. The subscribe-effect's closure captures the ref, not the
 * callback identity directly — so the latest callback is always invoked
 * regardless of how the caller passes it. Without this, the merge logic
 * inside the studio (which depends on the current `isDirty` flag and
 * `stagedData` snapshot) would always see the values that were current at
 * subscribe time.
 *
 * Migration
 * ---------
 * supabase/migrations/206 adds the `creatures` table to the Realtime
 * publication (mirrors objects' 147_objects_realtime.sql):
 *   ALTER TABLE creatures REPLICA IDENTITY FULL;
 *   ALTER PUBLICATION supabase_realtime ADD TABLE creatures;
 * REPLICA IDENTITY FULL is required so unchanged-TOAST JSONB columns
 * (the asset bucket arrays) are emitted in the UPDATE WAL payload —
 * without it, a worker writing to only `angles` would produce an event
 * whose payload omits the other bucket columns, and the studio would see
 * them as null.
 *
 * Usage
 * -----
 *   useCreatureRealtimeSync(creatureDbId, (newRow) => {
 *     // newRow is the raw DB row shape (snake_case via Supabase's default
 *     // Postgres replication). The caller is responsible for shape
 *     // conversion + the append-only merge into staged state.
 *   })
 */
import { useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase"

/**
 * Raw shape of a `creatures` row as it arrives from Postgres replication
 * (snake_case columns from the underlying table). Mirrors ObjectRealtimeRow
 * with the creature delta: `poses` replaces object's `materials`, and a
 * `species` column is carried (free-text). Permissive about JSONB column
 * types — the merge layer (`mergeRealtimeCreatureRow`) narrows via type
 * guards before appending.
 *
 * Only the columns the studio actually reads on a Realtime event are listed;
 * extra columns in the WAL payload (created_at, project_id, etc.) are ignored.
 */
export interface CreatureRealtimeRow {
  readonly id: string
  readonly user_id: string | null
  readonly project_id: string | null
  readonly node_id: string | null
  readonly name: string | null
  readonly description: string | null
  readonly species: string | null
  readonly category: string | null
  readonly style: string | null
  readonly source_image_url: string | null
  readonly canonical_description: string | null
  readonly style_lock: boolean | null
  readonly angles: unknown
  readonly poses: unknown
  readonly variations: unknown
  readonly motion_clips: unknown
  readonly reference_photos: unknown
  readonly updated_at: string | null
}

/**
 * Subscribes to Realtime UPDATE events on `creatures` filtered by id.
 *
 * @param creatureId — The DB id of the creature to subscribe to. When
 *   null/undefined the hook is a no-op (no channel is opened). Changing
 *   the id tears down the existing subscription and opens a fresh one.
 * @param onUpdate — Called with the row payload on every UPDATE event for
 *   the subscribed creature. The caller is responsible for shape
 *   conversion and the append-only merge into studio state.
 */
export function useCreatureRealtimeSync(
  creatureId: string | null | undefined,
  onUpdate: (row: CreatureRealtimeRow) => void,
): void {
  // Stash the callback in a ref so the subscribe-effect's closure never
  // captures a stale identity. The subscription is built once per
  // creatureId and its handler reads `.current` to invoke the latest
  // callback on every event.
  const cbRef = useRef(onUpdate)
  cbRef.current = onUpdate

  useEffect(() => {
    if (!creatureId) return

    const supabase = createClient()
    const channelName = `creature:${creatureId}`

    const channel = supabase
      .channel(channelName)
      .on(
        // Cast through unknown because supabase-js's overload for the
        // "postgres_changes" listen type uses string-literal generics
        // that confuse TS when destructured at our call site.
        "postgres_changes" as never,
        {
          event: "UPDATE",
          schema: "public",
          table: "creatures",
          filter: `id=eq.${creatureId}`,
        },
        (payload: { new: CreatureRealtimeRow | null }) => {
          const next = payload.new
          if (!next) return
          cbRef.current(next)
        },
      )
      .subscribe()

    return () => {
      // removeChannel handles both an active subscription and one in
      // the middle of joining; safe to call regardless of state.
      void supabase.removeChannel(channel)
    }
  }, [creatureId])
}

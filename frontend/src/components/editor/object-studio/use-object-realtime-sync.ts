/**
 * Subscribes to Supabase Realtime UPDATE events on the currently-open
 * `objects` row and invokes a caller-supplied callback with the new row.
 *
 * Why it exists
 * -------------
 * Workers writing back into an object row (asset auto-attach when an
 * image-generation job completes, source_image_url set by approve-main-image
 * via the worker path) need to surface their changes to the Object Studio
 * without the user closing/reopening the modal or hitting Save. Mirrors the
 * location-studio realtime hook — the badge on the canvas and the asset
 * grids inside the studio refresh instantly when a worker writes to one of
 * the JSONB bucket columns (angles, materials, variations, motion_clips,
 * reference_photos).
 *
 * Subscription scope
 * ------------------
 * The Postgres CDC filter (`id=eq.<objectId>`) restricts events to the
 * single object row currently open in the studio. RLS continues to apply
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
 * supabase/migrations/147_objects_realtime.sql adds (Phase A):
 *   ALTER TABLE objects REPLICA IDENTITY FULL;
 *   ALTER PUBLICATION supabase_realtime ADD TABLE objects;
 * REPLICA IDENTITY FULL is required so unchanged-TOAST JSONB columns
 * (the asset bucket arrays) are emitted in the UPDATE WAL payload —
 * without it, a worker writing to only `angles` would produce an event
 * whose payload omits the other bucket columns, and the studio would see
 * them as null.
 *
 * Usage
 * -----
 *   useObjectRealtimeSync(objectDbId, (newRow) => {
 *     // newRow is the raw DB row shape (snake_case via Supabase's default
 *     // Postgres replication). The caller is responsible for shape
 *     // conversion + the append-only merge into staged state.
 *   })
 */
import { useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase"
import type { ObjectRealtimeRow } from "@/types/nodes"

/**
 * Subscribes to Realtime UPDATE events on `objects` filtered by id.
 *
 * @param objectId — The DB id of the object to subscribe to. When
 *   null/undefined the hook is a no-op (no channel is opened). Changing
 *   the id tears down the existing subscription and opens a fresh one.
 * @param onUpdate — Called with the row payload on every UPDATE event for
 *   the subscribed object. The caller is responsible for shape
 *   conversion and the append-only merge into studio state.
 */
export function useObjectRealtimeSync(
  objectId: string | null | undefined,
  onUpdate: (row: ObjectRealtimeRow) => void,
): void {
  // Stash the callback in a ref so the subscribe-effect's closure never
  // captures a stale identity. The subscription is built once per
  // objectId and its handler reads `.current` to invoke the latest
  // callback on every event.
  const cbRef = useRef(onUpdate)
  cbRef.current = onUpdate

  useEffect(() => {
    if (!objectId) return

    const supabase = createClient()
    const channelName = `object:${objectId}`

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
          table: "objects",
          filter: `id=eq.${objectId}`,
        },
        (payload: { new: ObjectRealtimeRow | null }) => {
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
  }, [objectId])
}

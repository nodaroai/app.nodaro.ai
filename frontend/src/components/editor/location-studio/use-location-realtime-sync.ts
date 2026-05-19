/**
 * Subscribes to Supabase Realtime UPDATE events on the currently-open
 * `locations` row and invokes a caller-supplied callback with the new row.
 *
 * Why it exists
 * -------------
 * Workers writing back into a location row (asset auto-attach when an
 * image-generation job completes) need to surface their changes to the
 * Location Studio without the user closing/reopening the modal or hitting
 * Save. Phase 1 deliberately accepted polling lag here; Phase 2 #12 wires
 * up Realtime so the badge on the canvas and the asset grids inside the
 * studio refresh instantly when a worker writes to one of the JSONB bucket
 * columns (timeOfDay, weather, seasons, angles, lighting, atmosphereMotions,
 * referencePhotos).
 *
 * Subscription scope
 * ------------------
 * The Postgres CDC filter (`id=eq.<locationId>`) restricts events to the
 * single location row currently open in the studio. RLS continues to apply
 * on Realtime — Supabase enforces the same user_id-scoped policies on the
 * broadcast filter so the user only receives events for rows they can
 * SELECT. This matches the polling behavior we are replacing.
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
 * supabase/migrations/136_locations_jobs_realtime.sql adds:
 *   ALTER TABLE locations REPLICA IDENTITY FULL;
 *   ALTER PUBLICATION supabase_realtime ADD TABLE locations;
 * REPLICA IDENTITY FULL is required so unchanged-TOAST JSONB columns
 * (the asset bucket arrays) are emitted in the UPDATE WAL payload —
 * without it, a worker writing to only `timeOfDay` would produce an
 * event whose payload omits the other bucket columns, and the studio
 * would see them as null.
 *
 * Usage
 * -----
 *   useLocationRealtimeSync(locationDbId, (newRow) => {
 *     // newRow is the raw DB row shape (snake_case via Supabase's default
 *     // Postgres replication). The caller is responsible for shape
 *     // conversion + the append-only merge into staged state.
 *   })
 */
import { useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase"

/**
 * Raw shape of a `locations` row as it arrives from Postgres replication
 * (snake_case columns from the underlying table). Intentionally permissive
 * about asset column types — the caller normalizes/validates before
 * merging into studio state.
 *
 * Only the columns the studio actually reads on a Realtime event are
 * listed; extra columns in the WAL payload are ignored.
 */
export interface LocationRealtimeRow {
  readonly id: string
  readonly user_id: string | null
  readonly project_id: string | null
  readonly node_id: string | null
  readonly name: string | null
  readonly description: string | null
  readonly category: string | null
  readonly style: string | null
  readonly source_image_url: string | null
  readonly canonical_description: string | null
  readonly style_lock: boolean | null
  readonly time_of_day: unknown
  readonly weather: unknown
  readonly angles: unknown
  readonly lighting: unknown
  readonly seasons: unknown
  readonly atmosphere_motions: unknown
  readonly reference_photos: unknown
  readonly updated_at: string | null
}

/**
 * Subscribes to Realtime UPDATE events on `locations` filtered by id.
 *
 * @param locationId — The DB id of the location to subscribe to. When
 *   null/undefined the hook is a no-op (no channel is opened). Changing
 *   the id tears down the existing subscription and opens a fresh one.
 * @param onUpdate — Called with the row payload on every UPDATE event for
 *   the subscribed location. The caller is responsible for shape
 *   conversion and the append-only merge into studio state.
 */
export function useLocationRealtimeSync(
  locationId: string | null | undefined,
  onUpdate: (row: LocationRealtimeRow) => void,
): void {
  // Stash the callback in a ref so the subscribe-effect's closure never
  // captures a stale identity. The subscription is built once per
  // locationId and its handler reads `.current` to invoke the latest
  // callback on every event.
  const cbRef = useRef(onUpdate)
  cbRef.current = onUpdate

  useEffect(() => {
    if (!locationId) return

    const supabase = createClient()
    const channelName = `location:${locationId}`

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
          table: "locations",
          filter: `id=eq.${locationId}`,
        },
        (payload: { new: LocationRealtimeRow | null }) => {
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
  }, [locationId])
}

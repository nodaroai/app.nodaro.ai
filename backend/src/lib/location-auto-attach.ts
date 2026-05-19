import { LOCATION_ATTACH_COLUMNS, type LocationAttachColumn } from "@nodaro/shared"
import { supabase } from "./supabase.js"

/**
 * Runtime guard set built from the canonical `LOCATION_ATTACH_COLUMNS`. Used
 * to narrow a string `attachToColumn` (which travels through BullMQ as
 * loosely-typed JSON) to the `LocationAttachColumn` literal union before
 * we hand it to the RPC. A forged payload with an unknown column is
 * rejected here AND by the RPC's CASE/WHEN whitelist (migration 124).
 */
export const LOCATION_ATTACH_COLUMN_SET: ReadonlySet<string> = new Set(
  LOCATION_ATTACH_COLUMNS,
)

/**
 * Atomic append of a `{name, url}` entry to a `locations` JSONB column via
 * the `append_location_asset` RPC (migration 124). The RPC itself dedups by
 * URL and silently no-ops when the row is soft-deleted (`deleted_at IS NOT
 * NULL`), so this helper just forwards args and logs RPC errors.
 *
 * Errors are swallowed by design: the job result already lives on
 * `jobs.output_data`, credits are already committed, and throwing here would
 * only orphan a successful generation.
 */
export async function attachAssetToLocation(
  locationId: string,
  column: LocationAttachColumn,
  item: { name: string; url: string },
): Promise<void> {
  try {
    const { error } = await supabase.rpc("append_location_asset", {
      p_location_id: locationId,
      p_column: column,
      p_value: item,
    })
    if (error) {
      console.warn(
        `[location-attach] rpc append failed (location=${locationId}, column=${column}): ${error.message}`,
      )
    }
  } catch (e) {
    console.warn(
      `[location-attach] rpc append threw (location=${locationId}, column=${column}): ${String(e)}`,
    )
  }
}

/**
 * Belt-and-braces auto-attach to a `locations` JSONB column. The route
 * already verified `attachToLocationId` ownership before enqueueing, but
 * we re-verify here so a forged BullMQ payload can't bypass that check
 * and attach to another user's row.
 *
 * No-op when any required arg is missing (the caller decides whether to
 * skip the auto-attach for a given job — typically because the route
 * didn't enqueue the auto-attach hints), when the column isn't in the
 * canonical whitelist, OR when the ownership re-query returns no row
 * (cross-user / soft-deleted between enqueue and consume).
 *
 * Used by:
 *  - `entity.ts::makeEntityImageHandler` for image asset auto-attach
 *  - `entity.ts::handleGenerateLocationMotion` for atmosphere motion clips
 */
export async function autoAttachLocationAsset(args: {
  locationId: string | undefined
  column: string | undefined
  name: string | undefined
  userId: string | undefined
  url: string
}): Promise<void> {
  const { locationId, column, name, userId, url } = args
  if (!locationId || !column || !name || !userId) return
  if (!LOCATION_ATTACH_COLUMN_SET.has(column)) return

  const { data: row } = await supabase
    .from("locations")
    .select("id")
    .eq("id", locationId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single()
  if (!row) return

  await attachAssetToLocation(
    locationId,
    column as LocationAttachColumn,
    { name, url },
  )
}

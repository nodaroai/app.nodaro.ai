import { OBJECT_ATTACH_COLUMNS, type ObjectAttachColumn } from "@nodaro/shared"
import { supabase } from "./supabase.js"

/**
 * Runtime guard set built from the canonical OBJECT_ATTACH_COLUMNS. Used to
 * narrow a string `attachToColumn` (which travels through BullMQ as
 * loosely-typed JSON) to the ObjectAttachColumn literal union before we
 * hand it to the RPC. A forged payload with an unknown column is rejected
 * here AND by the RPC's CASE/WHEN whitelist (migration 147).
 */
export const OBJECT_ATTACH_COLUMN_SET: ReadonlySet<string> = new Set(
  OBJECT_ATTACH_COLUMNS,
)

/**
 * Atomic append of a `{name, url}` (or `{kind, url}` for reference_photos
 * — though reference_photos is frontend-owned, not worker-touched in
 * Phase 1) entry to an `objects` JSONB column via the append_object_asset
 * RPC (migration 147). The RPC itself dedups by URL and silently no-ops
 * when the row is soft-deleted (deleted_at IS NOT NULL), so this helper
 * just forwards args and logs RPC errors.
 *
 * Errors are swallowed by design: the job result already lives on
 * jobs.output_data, credits are already committed, and throwing here
 * would only orphan a successful generation.
 */
export async function attachAssetToObject(
  objectId: string,
  column: ObjectAttachColumn,
  item: { name: string; url: string } & Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await supabase.rpc("append_object_asset", {
      p_object_id: objectId,
      p_column: column,
      p_value: item,
    })
    if (error) {
      console.warn(
        `[object-attach] rpc append failed (object=${objectId}, column=${column}): ${error.message}`,
      )
    }
  } catch (e) {
    console.warn(
      `[object-attach] rpc append threw (object=${objectId}, column=${column}): ${String(e)}`,
    )
  }
}

/**
 * Belt-and-braces auto-attach to an `objects` JSONB column. The route
 * already verified `attachToObjectId` ownership before enqueueing, but
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
 *  - entity.ts::makeEntityImageHandler for image asset auto-attach (Phase D)
 *  - entity.ts::handleGenerateObjectMotion for motion clips (Phase D)
 */
export async function autoAttachObjectAsset(args: {
  objectId: string | undefined
  column: string | undefined
  name: string | undefined
  userId: string | undefined
  url: string
  /** Full JSONB record to persist verbatim (e.g. a reference-sheet record with
   *  type/skin/flavour/panelUrls). Defaults to a minimal `{ name, url }`. The
   *  RPC stores whatever JSONB it's given and dedups by `url`. */
  item?: Record<string, unknown>
}): Promise<void> {
  const { objectId, column, name, userId, url, item } = args
  if (!objectId || !column || !name || !userId) return
  if (!OBJECT_ATTACH_COLUMN_SET.has(column)) return

  const { data: row } = await supabase
    .from("objects")
    .select("id")
    .eq("id", objectId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single()
  if (!row) return

  await attachAssetToObject(
    objectId,
    column as ObjectAttachColumn,
    item ? { ...item, name, url } : { name, url },
  )
}

/**
 * Single-candidate auto-attach: write the generated URL to
 * `objects.source_image_url` for the user's row, ownership + soft-delete
 * guarded. Used by `makeEntityImageHandler` when `logPrefix === "generate-object"`
 * AND `attachToObjectId` is set in the queue payload (route only forwards
 * `attachToObjectId` for count === 1; multi-candidate flows leave it
 * undefined so the user approves via approve_object_main_image).
 *
 * Errors are swallowed by design (the result URL is already on jobs.output_data;
 * throwing here would orphan a successful generation). Mirrors
 * setCharacterPortrait in lib/character-auto-attach.ts:95.
 *
 * Explicit `updated_at = new Date().toISOString()` is belt-and-braces
 * alongside the trigger (matches the location-main-image-approval pattern).
 */
export async function setObjectMainImage(args: {
  objectId: string
  userId: string
  url: string
}): Promise<boolean> {
  const { objectId, userId, url } = args
  try {
    const { error } = await supabase
      .from("objects")
      .update({ source_image_url: url, updated_at: new Date().toISOString() })
      .eq("id", objectId)
      .eq("user_id", userId)
      .is("deleted_at", null)
    if (error) {
      console.warn(
        `[object-attach] set source_image_url failed (object=${objectId}): ${error.message}`,
      )
      return false
    }
    return true
  } catch (e) {
    console.warn(
      `[object-attach] set source_image_url threw (object=${objectId}): ${String(e)}`,
    )
    return false
  }
}

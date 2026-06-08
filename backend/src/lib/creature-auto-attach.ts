import { CREATURE_ATTACH_COLUMNS, type CreatureAttachColumn } from "@nodaro/shared"
import { supabase } from "./supabase.js"

/**
 * Runtime guard set built from the canonical CREATURE_ATTACH_COLUMNS. Used to
 * narrow a string `attachToColumn` (which travels through BullMQ as
 * loosely-typed JSON) to the CreatureAttachColumn literal union before we
 * hand it to the RPC. A forged payload with an unknown column is rejected
 * here AND by the RPC's CASE/WHEN whitelist (migration 206).
 */
export const CREATURE_ATTACH_COLUMN_SET: ReadonlySet<string> = new Set(
  CREATURE_ATTACH_COLUMNS,
)

/**
 * Atomic append of a `{name, url}` (or `{kind, url}` for reference_photos
 * — though reference_photos is frontend-owned, not worker-touched in
 * Phase 1) entry to a `creatures` JSONB column via the append_creature_asset
 * RPC (migration 206). The RPC itself dedups by URL and silently no-ops
 * when the row is soft-deleted (deleted_at IS NOT NULL), so this helper
 * just forwards args and logs RPC errors.
 *
 * Errors are swallowed by design: the job result already lives on
 * jobs.output_data, credits are already committed, and throwing here
 * would only orphan a successful generation.
 */
export async function attachAssetToCreature(
  creatureId: string,
  column: CreatureAttachColumn,
  item: { name: string; url: string } & Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await supabase.rpc("append_creature_asset", {
      p_creature_id: creatureId,
      p_column: column,
      p_value: item,
    })
    if (error) {
      console.warn(
        `[creature-attach] rpc append failed (creature=${creatureId}, column=${column}): ${error.message}`,
      )
    }
  } catch (e) {
    console.warn(
      `[creature-attach] rpc append threw (creature=${creatureId}, column=${column}): ${String(e)}`,
    )
  }
}

/**
 * Belt-and-braces auto-attach to a `creatures` JSONB column. The route
 * already verified `attachToCreatureId` ownership before enqueueing, but
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
 *  - entity.ts::handleGenerateCreatureMotion for motion clips (Phase D)
 */
export async function autoAttachCreatureAsset(args: {
  creatureId: string | undefined
  column: string | undefined
  name: string | undefined
  userId: string | undefined
  url: string
  /** Full JSONB record to persist verbatim (e.g. a reference-sheet record with
   *  type/skin/flavour/panelUrls). Defaults to a minimal `{ name, url }`. The
   *  RPC stores whatever JSONB it's given and dedups by `url`. */
  item?: Record<string, unknown>
}): Promise<void> {
  const { creatureId, column, name, userId, url, item } = args
  if (!creatureId || !column || !name || !userId) return
  if (!CREATURE_ATTACH_COLUMN_SET.has(column)) return

  const { data: row } = await supabase
    .from("creatures")
    .select("id")
    .eq("id", creatureId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single()
  if (!row) return

  await attachAssetToCreature(
    creatureId,
    column as CreatureAttachColumn,
    item ? { ...item, name, url } : { name, url },
  )
}

/**
 * Single-candidate auto-attach: write the generated URL to
 * `creatures.source_image_url` for the user's row, ownership + soft-delete
 * guarded. Used by `makeEntityImageHandler` when `logPrefix === "generate-creature"`
 * AND `attachToCreatureId` is set in the queue payload (route only forwards
 * `attachToCreatureId` for count === 1; multi-candidate flows leave it
 * undefined so the user approves via approve_creature_main_image).
 *
 * Errors are swallowed by design (the result URL is already on jobs.output_data;
 * throwing here would orphan a successful generation). Mirrors
 * setCharacterPortrait in lib/character-auto-attach.ts:95.
 *
 * Explicit `updated_at = new Date().toISOString()` is belt-and-braces
 * alongside the trigger (matches the location-main-image-approval pattern).
 */
export async function setCreatureMainImage(args: {
  creatureId: string
  userId: string
  url: string
}): Promise<boolean> {
  const { creatureId, userId, url } = args
  try {
    const { error } = await supabase
      .from("creatures")
      .update({ source_image_url: url, updated_at: new Date().toISOString() })
      .eq("id", creatureId)
      .eq("user_id", userId)
      .is("deleted_at", null)
    if (error) {
      console.warn(
        `[creature-attach] set source_image_url failed (creature=${creatureId}): ${error.message}`,
      )
      return false
    }
    return true
  } catch (e) {
    console.warn(
      `[creature-attach] set source_image_url threw (creature=${creatureId}): ${String(e)}`,
    )
    return false
  }
}

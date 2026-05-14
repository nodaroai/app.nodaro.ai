import { supabase } from "./supabase.js"

/**
 * Columns on `characters` that hold JSONB arrays of `{name, url}` items.
 * Kept in sync with the `append_character_asset` RPC whitelist (migration 111,
 * extended in 118 to include `body_angles`).
 */
export type CharacterAssetColumn =
  | "expressions"
  | "poses"
  | "lighting_variations"
  | "angles"
  | "body_angles"
  | "motions"

const VALID_ASSET_COLUMNS: ReadonlySet<CharacterAssetColumn> = new Set([
  "expressions",
  "poses",
  "lighting_variations",
  "angles",
  "body_angles",
  "motions",
])

/**
 * Maps the route-level assetType (which doubles as the prompt-build key —
 * "lighting", not "lighting_variations") to its actual DB column. The studio
 * frontend currently uses "lighting"; the column is "lighting_variations".
 * Callers can pass either form here.
 */
export function resolveAssetColumn(value: string): CharacterAssetColumn | null {
  const normalized = value === "lighting" ? "lighting_variations" : value
  return VALID_ASSET_COLUMNS.has(normalized as CharacterAssetColumn)
    ? (normalized as CharacterAssetColumn)
    : null
}

/**
 * Shape of a single JSONB item appended to a character asset column. `name`
 * + `url` are the minimum (every asset has both); `description`,
 * `motionDescription`, and `realLifeRefs` are richer Character Studio
 * fields that travel alongside the asset for downstream prompt enrichment
 * (see Character Studio PR 1 plan).
 */
export interface CharacterAssetItem {
  name: string
  url: string
  description?: string
  motionDescription?: string
  realLifeRefs?: string[]
}

/**
 * Atomic append of a richer-shape character asset entry to the named JSONB
 * column. The SQL RPC `append_character_asset` accepts an arbitrary JSONB
 * `p_item`, so no DB change is required — only this TypeScript shape change.
 *
 * On failure: returns false (logged, swallowed). The job result still lives
 * on `jobs.output_data`; the frontend's in-flight poll can still resolve.
 * Throwing here would only orphan committed credits.
 */
export async function attachAssetToCharacter(args: {
  characterId: string
  userId: string
  column: CharacterAssetColumn
  item: CharacterAssetItem
}): Promise<boolean> {
  const { characterId, userId, column, item } = args
  try {
    const { error } = await supabase.rpc("append_character_asset", {
      p_character_id: characterId,
      p_user_id: userId,
      p_column: column,
      p_item: item,
    })
    if (error) {
      console.warn(
        `[character-attach] rpc append failed (character=${characterId}, column=${column}): ${error.message}`,
      )
      return false
    }
    return true
  } catch (e) {
    console.warn(
      `[character-attach] rpc append threw (character=${characterId}, column=${column}): ${String(e)}`,
    )
    return false
  }
}

/**
 * Set `characters.source_image_url` on the user's row. No race concern (one
 * portrait at a time per studio session), so a plain UPDATE is fine.
 */
export async function setCharacterPortrait(args: {
  characterId: string
  userId: string
  url: string
}): Promise<boolean> {
  const { characterId, userId, url } = args
  try {
    const { error } = await supabase
      .from("characters")
      .update({ source_image_url: url, updated_at: new Date().toISOString() })
      .eq("id", characterId)
      .eq("user_id", userId)
    if (error) {
      console.warn(
        `[character-attach] portrait update failed (character=${characterId}): ${error.message}`,
      )
      return false
    }
    return true
  } catch (e) {
    console.warn(
      `[character-attach] portrait update threw (character=${characterId}): ${String(e)}`,
    )
    return false
  }
}

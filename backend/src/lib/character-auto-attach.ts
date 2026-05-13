import { supabase } from "./supabase.js"

/**
 * Columns on `characters` that hold JSONB arrays of `{name, url}` items.
 * Kept in sync with migration 111's `append_character_asset` whitelist.
 */
export type CharacterAssetColumn =
  | "expressions"
  | "poses"
  | "lighting_variations"
  | "angles"
  | "motions"

const VALID_ASSET_COLUMNS: ReadonlySet<CharacterAssetColumn> = new Set([
  "expressions",
  "poses",
  "lighting_variations",
  "angles",
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
 * Atomic append of `{name, url}` to a JSONB-array column on the user's
 * character row. Survives concurrent completions because the SQL uses
 * `array || new_item` at the DB layer (see migration 111).
 *
 * Returns true on success. Failures are logged and swallowed — auto-attach is
 * best-effort: the job result is already in `jobs.output_data`, and the
 * frontend can still surface the asset via its in-flight poll. Throwing here
 * would only orphan the spent credits.
 */
export async function attachAssetToCharacter(args: {
  characterId: string
  userId: string
  column: CharacterAssetColumn
  name: string
  url: string
}): Promise<boolean> {
  const { characterId, userId, column, name, url } = args
  try {
    const { error } = await supabase.rpc("append_character_asset", {
      p_character_id: characterId,
      p_user_id: userId,
      p_column: column,
      p_item: { name, url },
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

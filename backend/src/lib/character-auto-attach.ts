import { CHARACTER_ATTACH_COLUMNS, type CharacterAttachColumn } from "@nodaro/shared"
import { supabase } from "./supabase.js"

/**
 * Columns on `characters` that hold JSONB arrays of `{name, url}` items.
 * Derived from the canonical `CHARACTER_ATTACH_COLUMNS` (single source of
 * truth, shared with the route's Zod enum) PLUS `"motions"` — the video-clip
 * column, which lives outside the image-asset attach array but is still a
 * valid `append_character_asset` target (`handleGenerateCharacterMotion`
 * passes it as a literal). Deriving from the shared array means new attach
 * buckets (reference-sheet `sheets`/`detail_closeups`/`outfit_variations`,
 * migration 200) are accepted here automatically without a second edit.
 * Stays in sync with the `append_character_asset` RPC whitelist (migration
 * 111 → 118 `body_angles` → 200 sheet buckets).
 */
export type CharacterAssetColumn = CharacterAttachColumn | "motions"

const VALID_ASSET_COLUMNS: ReadonlySet<CharacterAssetColumn> = new Set<CharacterAssetColumn>([
  ...CHARACTER_ATTACH_COLUMNS,
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
 * Atomic append of a completed generate-video clip's R2 URL to
 * `characters.reference_videos_by_variant[variant]`. Mirrors
 * `attachAssetToCharacter`: best-effort, swallows + logs failure, never throws.
 *
 * Used by `lib/job-finalize.ts` after a video job completes (worker AND
 * reconcile cron paths) when the originating request carried
 * `attachToCharacterId` + `attachReferenceVideoVariant` in `jobs.input_data`.
 *
 * The RPC (`append_character_reference_video`, migration 206) re-verifies
 * ownership inside the DB (`WHERE id = p_character_id AND user_id = p_user_id
 * AND deleted_at IS NULL`) — and `userId` here is the authoritative job owner
 * (`jobs.user_id`, set from the auth token at job creation), NOT a body field
 * — so a forged `attachToCharacterId` pointing at another user's character is
 * a silent no-op. It also lowercases/trims the key, dedupes, and enforces the
 * same caps as the route (20 keys, 5 URLs each).
 *
 * On failure: returns false (logged, swallowed). The clip still lives on
 * `jobs.output_data`; throwing here would only orphan committed credits.
 */
export async function appendCharacterReferenceVideo(args: {
  characterId: string
  userId: string
  variant: string
  url: string
}): Promise<boolean> {
  const { characterId, userId, variant, url } = args
  try {
    const { error } = await supabase.rpc("append_character_reference_video", {
      p_character_id: characterId,
      p_user_id: userId,
      p_variant: variant,
      p_url: url,
    })
    if (error) {
      console.warn(
        `[character-attach] reference-video append failed (character=${characterId}, variant=${variant}): ${error.message}`,
      )
      return false
    }
    return true
  } catch (e) {
    console.warn(
      `[character-attach] reference-video append threw (character=${characterId}, variant=${variant}): ${String(e)}`,
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

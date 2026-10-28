/**
 * The `nodaro_motion_prism_reference_audio` row's admin read and write
 * (`cast-swap-prism-reference-audio.ts` defines and parses it). Lives in lib/,
 * as the other Nodaro Motion settings' stores do: app_settings is
 * instance-global config written with the service-role client.
 */
import { supabase } from "./supabase.js"
import { invalidateSettingsCache } from "./app-settings.js"
import {
  NODARO_MOTION_PRISM_REFERENCE_AUDIO_KEY,
  parseNodaroMotionPrismReferenceAudio,
  type CastSwapPrismReferenceAudio,
} from "./cast-swap-prism-reference-audio.js"

/** The stored row, read fresh (not through the cache): what an admin screen shows. null = never saved. Throws on a database error. */
export async function readNodaroMotionPrismReferenceAudio(): Promise<{
  prismReferenceAudio: CastSwapPrismReferenceAudio | null
  updatedAt: string | null
}> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", NODARO_MOTION_PRISM_REFERENCE_AUDIO_KEY)
    .maybeSingle()
  if (error) throw new Error(`Could not read ${NODARO_MOTION_PRISM_REFERENCE_AUDIO_KEY}: ${error.message}`)
  const row = data as { value?: unknown; updated_at?: string | null } | null
  return {
    prismReferenceAudio: row ? parseNodaroMotionPrismReferenceAudio(row.value) : null,
    updatedAt: row?.updated_at ?? null,
  }
}

/**
 * Save the setting (already validated) and clear this process's settings
 * cache; the other servers converge on their own cache expiry (about 60 s).
 * Throws on a database error.
 */
export async function saveNodaroMotionPrismReferenceAudio(prismReferenceAudio: CastSwapPrismReferenceAudio, adminId: string): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: NODARO_MOTION_PRISM_REFERENCE_AUDIO_KEY, value: prismReferenceAudio, updated_at: new Date().toISOString(), updated_by: adminId },
      { onConflict: "key" },
    )
  if (error) throw new Error(`Could not save ${NODARO_MOTION_PRISM_REFERENCE_AUDIO_KEY}: ${error.message}`)
  invalidateSettingsCache()
}

/**
 * The `nodaro_motion_precise_art_style` row's admin read and write
 * (`nodaro-motion-precise-art-style.ts` defines and parses it). Lives in lib/,
 * as the other Nodaro Motion settings' stores do: app_settings is
 * instance-global config written with the service-role client.
 */
import { supabase } from "./supabase.js"
import { invalidateSettingsCache } from "./app-settings.js"
import {
  NODARO_MOTION_PRECISE_ART_STYLE_KEY,
  parseNodaroMotionPreciseArtStyle,
  withoutDefaultPreciseArtStyle,
  type NodaroMotionPreciseArtStyle,
} from "./nodaro-motion-precise-art-style.js"

/** The stored row, read fresh (not through the cache): what an admin screen shows. null = never saved. Throws on a database error. */
export async function readNodaroMotionPreciseArtStyle(): Promise<{ preciseArtStyle: NodaroMotionPreciseArtStyle | null; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", NODARO_MOTION_PRECISE_ART_STYLE_KEY)
    .maybeSingle()
  if (error) throw new Error(`Could not read ${NODARO_MOTION_PRECISE_ART_STYLE_KEY}: ${error.message}`)
  const row = data as { value?: unknown; updated_at?: string | null } | null
  return { preciseArtStyle: row ? parseNodaroMotionPreciseArtStyle(row.value) : null, updatedAt: row?.updated_at ?? null }
}

/**
 * Save the whole setting (already validated by
 * `nodaroMotionPreciseArtStyleSchema`), the defaults left out, under the
 * current keys only, and clear this process's settings cache; the other
 * servers converge on their own cache expiry (about 60 s). Throws on a
 * database error.
 */
export async function saveNodaroMotionPreciseArtStyle(preciseArtStyle: NodaroMotionPreciseArtStyle, adminId: string): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      {
        key: NODARO_MOTION_PRECISE_ART_STYLE_KEY,
        value: withoutDefaultPreciseArtStyle(preciseArtStyle),
        updated_at: new Date().toISOString(),
        updated_by: adminId,
      },
      { onConflict: "key" },
    )
  if (error) throw new Error(`Could not save ${NODARO_MOTION_PRECISE_ART_STYLE_KEY}: ${error.message}`)
  invalidateSettingsCache()
}

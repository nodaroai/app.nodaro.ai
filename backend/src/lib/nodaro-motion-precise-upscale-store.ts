/**
 * The `nodaro_motion_precise_upscale` row's admin read and write
 * (`cast-swap-prism-precise-upscale.ts` defines and parses it). Lives in lib/,
 * as the other Video Remake settings' stores do: app_settings is
 * instance-global config written with the service-role client.
 */
import { supabase } from "./supabase.js"
import { invalidateSettingsCache } from "./app-settings.js"
import {
  NODARO_MOTION_PRECISE_UPSCALE_KEY,
  parseNodaroMotionPreciseUpscale,
  type NodaroMotionPreciseUpscale,
} from "./cast-swap-prism-precise-upscale.js"

/** The stored row, read fresh (not through the cache): what an admin screen shows. null = never saved. Throws on a database error. */
export async function readNodaroMotionPreciseUpscale(): Promise<{ preciseUpscale: NodaroMotionPreciseUpscale | null; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", NODARO_MOTION_PRECISE_UPSCALE_KEY)
    .maybeSingle()
  if (error) throw new Error(`Could not read ${NODARO_MOTION_PRECISE_UPSCALE_KEY}: ${error.message}`)
  const row = data as { value?: unknown; updated_at?: string | null } | null
  return { preciseUpscale: row ? parseNodaroMotionPreciseUpscale(row.value) : null, updatedAt: row?.updated_at ?? null }
}

/**
 * Save the whole setting (already validated by `nodaroMotionPreciseUpscaleSchema`) and clear this process's
 * settings cache; the other servers see the save within about a second (app-settings-version.ts). Throws on a database error.
 */
export async function saveNodaroMotionPreciseUpscale(preciseUpscale: NodaroMotionPreciseUpscale, adminId: string): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      {
        key: NODARO_MOTION_PRECISE_UPSCALE_KEY,
        value: preciseUpscale,
        updated_at: new Date().toISOString(),
        updated_by: adminId,
      },
      { onConflict: "key" },
    )
  if (error) throw new Error(`Could not save ${NODARO_MOTION_PRECISE_UPSCALE_KEY}: ${error.message}`)
  invalidateSettingsCache()
}

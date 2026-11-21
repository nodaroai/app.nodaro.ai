/**
 * The `nodaro_motion_shot_list_fps` row's admin read and write
 * (`nodaro-motion-shot-list-fps.ts` defines and parses it). Lives in lib/, as the
 * other Video Remake settings' stores do: app_settings is instance-global
 * config written with the service-role client.
 */
import { supabase } from "./supabase.js"
import { invalidateSettingsCache } from "./app-settings.js"
import { NODARO_MOTION_SHOT_LIST_FPS_KEY, parseNodaroMotionShotListFps, withoutDefaultShotListFps, type NodaroMotionShotListFps } from "./nodaro-motion-shot-list-fps.js"

/** The stored row, read fresh (not through the cache): what an admin screen shows. null = never saved. Throws on a database error. */
export async function readNodaroMotionShotListFps(): Promise<{ shotListFps: NodaroMotionShotListFps | null; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", NODARO_MOTION_SHOT_LIST_FPS_KEY)
    .maybeSingle()
  if (error) throw new Error(`Could not read ${NODARO_MOTION_SHOT_LIST_FPS_KEY}: ${error.message}`)
  const row = data as { value?: unknown; updated_at?: string | null } | null
  return { shotListFps: row ? parseNodaroMotionShotListFps(row.value) : null, updatedAt: row?.updated_at ?? null }
}

/**
 * Save the whole setting (already validated by `nodaroMotionShotListFpsSchema`),
 * what an admin never set left out, and clear this process's settings cache;
 * the other servers see the save within about a second (app-settings-version.ts). Throws on a database error.
 */
export async function saveNodaroMotionShotListFps(shotListFps: NodaroMotionShotListFps, adminId: string): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: NODARO_MOTION_SHOT_LIST_FPS_KEY, value: withoutDefaultShotListFps(shotListFps), updated_at: new Date().toISOString(), updated_by: adminId },
      { onConflict: "key" },
    )
  if (error) throw new Error(`Could not save ${NODARO_MOTION_SHOT_LIST_FPS_KEY}: ${error.message}`)
  invalidateSettingsCache()
}

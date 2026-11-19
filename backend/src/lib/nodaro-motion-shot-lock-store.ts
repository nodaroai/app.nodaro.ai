/**
 * The `nodaro_motion_shot_lock` row's admin read and write
 * (`nodaro-motion-shot-lock.ts` defines and parses it). Lives in lib/, as the
 * other Video Remake settings' stores do: app_settings is instance-global
 * config written with the service-role client.
 */
import { supabase } from "./supabase.js"
import { invalidateSettingsCache } from "./app-settings.js"
import { NODARO_MOTION_SHOT_LOCK_KEY, parseNodaroMotionShotLock, shotLocksOn, type NodaroMotionShotLock } from "./nodaro-motion-shot-lock.js"

/** The stored row, read fresh (not through the cache): what an admin screen shows. null = never saved. Throws on a database error. */
export async function readNodaroMotionShotLock(): Promise<{ shotLock: NodaroMotionShotLock | null; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", NODARO_MOTION_SHOT_LOCK_KEY)
    .maybeSingle()
  if (error) throw new Error(`Could not read ${NODARO_MOTION_SHOT_LOCK_KEY}: ${error.message}`)
  const row = data as { value?: unknown; updated_at?: string | null } | null
  return { shotLock: row ? parseNodaroMotionShotLock(row.value) : null, updatedAt: row?.updated_at ?? null }
}

/**
 * Save the whole setting (already validated by `nodaroMotionShotLockSchema`),
 * `"off"` entries left out, under the current keys only, and clear this process's
 * settings cache; the other servers see the save within about a second (app-settings-version.ts). Throws on a database error.
 */
export async function saveNodaroMotionShotLock(shotLock: NodaroMotionShotLock, adminId: string): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: NODARO_MOTION_SHOT_LOCK_KEY, value: shotLocksOn(shotLock), updated_at: new Date().toISOString(), updated_by: adminId },
      { onConflict: "key" },
    )
  if (error) throw new Error(`Could not save ${NODARO_MOTION_SHOT_LOCK_KEY}: ${error.message}`)
  invalidateSettingsCache()
}

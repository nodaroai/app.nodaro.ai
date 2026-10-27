/**
 * The `nodaro_motion_motion` row's admin read and write
 * (`nodaro-motion-motion.ts` defines and parses it). Lives in lib/, as the
 * masking setting's store does: app_settings is instance-global config
 * written with the service-role client.
 */
import { supabase } from "./supabase.js"
import { invalidateSettingsCache } from "./app-settings.js"
import { NODARO_MOTION_MOTION_KEY, parseNodaroMotionMotion, type NodaroMotionMotion } from "./nodaro-motion-motion.js"

/** The stored row, read fresh (not through the cache): what an admin screen shows. Throws on a database error. */
export async function readNodaroMotionMotion(): Promise<{ motion: NodaroMotionMotion | null; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", NODARO_MOTION_MOTION_KEY)
    .maybeSingle()
  if (error) throw new Error(`Could not read ${NODARO_MOTION_MOTION_KEY}: ${error.message}`)
  const row = data as { value?: unknown; updated_at?: string | null } | null
  return { motion: row ? parseNodaroMotionMotion(row.value) : null, updatedAt: row?.updated_at ?? null }
}

/**
 * Save the whole setting (already validated by `nodaroMotionMotionSchema`)
 * and clear this process's settings cache. Written under the current keys
 * only, as the prompt parts row is: no app from before the 2026-10-26 rename
 * reads this row (the masking row's two-key write has no reason here), while
 * a plugin that looks up the earlier keys still finds them through the
 * toolkit's answer (`withEarlierMotionKeys`). The worker and the other
 * servers converge on their own cache expiry (about 60 s). Throws on a
 * database error.
 */
export async function saveNodaroMotionMotion(motion: NodaroMotionMotion, adminId: string): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: NODARO_MOTION_MOTION_KEY, value: motion, updated_at: new Date().toISOString(), updated_by: adminId },
      { onConflict: "key" },
    )
  if (error) throw new Error(`Could not save ${NODARO_MOTION_MOTION_KEY}: ${error.message}`)
  invalidateSettingsCache()
}

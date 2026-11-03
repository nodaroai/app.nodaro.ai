/**
 * The `nodaro_motion_advanced` row's admin read and write
 * (`nodaro-motion-advanced.ts` defines and parses it). Lives in lib/, as the
 * other Nodaro Motion settings' stores do: app_settings is instance-global
 * config written with the service-role client.
 */
import { supabase } from "./supabase.js"
import { invalidateSettingsCache } from "./app-settings.js"
import { NODARO_MOTION_ADVANCED_KEY, parseNodaroMotionAdvanced, type NodaroMotionAdvanced } from "./nodaro-motion-advanced.js"

/** The stored row, read fresh (not through the cache): what an admin screen shows. null = never saved (or unreadable). Throws on a database error. */
export async function readNodaroMotionAdvanced(): Promise<{ advanced: NodaroMotionAdvanced | null; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", NODARO_MOTION_ADVANCED_KEY)
    .maybeSingle()
  if (error) throw new Error(`Could not read ${NODARO_MOTION_ADVANCED_KEY}: ${error.message}`)
  const row = data as { value?: unknown; updated_at?: string | null } | null
  return { advanced: row ? parseNodaroMotionAdvanced(row.value) : null, updatedAt: row?.updated_at ?? null }
}

/**
 * Save the switch (already validated by `nodaroMotionAdvancedSchema`) and
 * clear this process's settings cache; the other servers converge on their
 * own cache expiry (about 60 s). Throws on a database error.
 */
export async function saveNodaroMotionAdvanced(advanced: NodaroMotionAdvanced, adminId: string): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: NODARO_MOTION_ADVANCED_KEY, value: { show: advanced.show }, updated_at: new Date().toISOString(), updated_by: adminId },
      { onConflict: "key" },
    )
  if (error) throw new Error(`Could not save ${NODARO_MOTION_ADVANCED_KEY}: ${error.message}`)
  invalidateSettingsCache()
}

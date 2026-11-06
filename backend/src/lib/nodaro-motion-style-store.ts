/**
 * The `nodaro_motion_style` row's admin read and write
 * (`nodaro-motion-style.ts` defines and parses it). Lives in lib/, as the
 * other Nodaro Motion settings' stores do: app_settings is instance-global
 * config written with the service-role client.
 */
import { supabase } from "./supabase.js"
import { invalidateSettingsCache } from "./app-settings.js"
import { NODARO_MOTION_STYLE_KEY, forcedStyles, parseNodaroMotionStyle, type NodaroMotionStyle } from "./nodaro-motion-style.js"

/** The stored row, read fresh (not through the cache): what an admin screen shows. null = never saved. Throws on a database error. */
export async function readNodaroMotionStyle(): Promise<{ style: NodaroMotionStyle | null; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", NODARO_MOTION_STYLE_KEY)
    .maybeSingle()
  if (error) throw new Error(`Could not read ${NODARO_MOTION_STYLE_KEY}: ${error.message}`)
  const row = data as { value?: unknown; updated_at?: string | null } | null
  return { style: row ? parseNodaroMotionStyle(row.value) : null, updatedAt: row?.updated_at ?? null }
}

/**
 * Save the whole setting (already validated by `nodaroMotionStyleSchema`),
 * `"user"` entries left out, under the current keys only (as the Motion row
 * is: the toolkit answers the earlier keys too), and clear this process's
 * settings cache; the other servers see the save within about a second (app-settings-version.ts). Throws on a database error.
 */
export async function saveNodaroMotionStyle(style: NodaroMotionStyle, adminId: string): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: NODARO_MOTION_STYLE_KEY, value: forcedStyles(style), updated_at: new Date().toISOString(), updated_by: adminId },
      { onConflict: "key" },
    )
  if (error) throw new Error(`Could not save ${NODARO_MOTION_STYLE_KEY}: ${error.message}`)
  invalidateSettingsCache()
}

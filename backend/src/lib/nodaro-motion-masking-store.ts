/**
 * The `nodaro_motion_masking` row's admin read and write
 * (`nodaro-motion-masking.ts` defines and parses it). Lives in lib/, not in
 * the route, as `saveNodaroProviderPrefs` does: app_settings is
 * instance-global config written with the service-role client.
 */
import { supabase } from "./supabase.js"
import { invalidateSettingsCache } from "./app-settings.js"
import { NODARO_MOTION_MASKING_KEY, parseNodaroMotionMasking, withEarlierMaskingKeys, type NodaroMotionMasking } from "./nodaro-motion-masking.js"

/** The stored row, read fresh (not through the cache): what an admin screen shows. Throws on a database error. */
export async function readNodaroMotionMasking(): Promise<{ masking: NodaroMotionMasking | null; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", NODARO_MOTION_MASKING_KEY)
    .maybeSingle()
  if (error) throw new Error(`Could not read ${NODARO_MOTION_MASKING_KEY}: ${error.message}`)
  const row = data as { value?: unknown; updated_at?: string | null } | null
  return { masking: row ? parseNodaroMotionMasking(row.value) : null, updatedAt: row?.updated_at ?? null }
}

/**
 * Save the whole setting (already validated by `nodaroMotionMaskingSchema`)
 * and clear this process's settings cache. TRANSITION SHIM (the 2026-10-26
 * rename): the row is written under the current AND the earlier keys
 * (`withEarlierMaskingKeys`), because staging and production share this one
 * row and an app from before the rename reads only `"motion-pro"` /
 * `"motion-lite"` — a save that wrote the current keys alone would turn off
 * every masking setting there. The current parse prefers the current keys.
 * Write the current keys only once every environment runs the renamed app; the worker and the other servers
 * converge on their own cache expiry (about 60 s). Lives here, not in the
 * route, as `saveNodaroProviderPrefs` does: app_settings is instance-global
 * config written with the service-role client. Throws on a database error.
 */
export async function saveNodaroMotionMasking(masking: NodaroMotionMasking, adminId: string): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      // updated_at moves on every save (the admin screen's "Saved" time), with who saved it.
      { key: NODARO_MOTION_MASKING_KEY, value: withEarlierMaskingKeys(masking), updated_at: new Date().toISOString(), updated_by: adminId },
      { onConflict: "key" },
    )
  if (error) throw new Error(`Could not save ${NODARO_MOTION_MASKING_KEY}: ${error.message}`)
  invalidateSettingsCache()
}

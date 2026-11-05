/**
 * The `nodaro_motion_precise_style_route` row's admin read and write
 * (`nodaro-motion-precise-style-route.ts` defines and parses it). Lives in lib/,
 * as the other Nodaro Motion settings' stores do: app_settings is
 * instance-global config written with the service-role client.
 */
import { supabase } from "./supabase.js"
import { invalidateSettingsCache } from "./app-settings.js"
import {
  NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY,
  parseNodaroMotionPreciseStyleRoute,
  withoutDefaultPreciseStyleRoute,
  type NodaroMotionPreciseStyleRoute,
} from "./nodaro-motion-precise-style-route.js"

/** The stored row, read fresh (not through the cache): what an admin screen shows. null = never saved. Throws on a database error. */
export async function readNodaroMotionPreciseStyleRoute(): Promise<{ preciseStyleRoute: NodaroMotionPreciseStyleRoute | null; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY)
    .maybeSingle()
  if (error) throw new Error(`Could not read ${NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY}: ${error.message}`)
  const row = data as { value?: unknown; updated_at?: string | null } | null
  return { preciseStyleRoute: row ? parseNodaroMotionPreciseStyleRoute(row.value) : null, updatedAt: row?.updated_at ?? null }
}

/**
 * Save the whole setting (already validated by
 * `nodaroMotionPreciseStyleRouteSchema`), the defaults left out, and clear this
 * process's settings cache; the other servers converge on their own cache
 * expiry (about 60 s). Throws on a database error.
 */
export async function saveNodaroMotionPreciseStyleRoute(preciseStyleRoute: NodaroMotionPreciseStyleRoute, adminId: string): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      {
        key: NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY,
        value: withoutDefaultPreciseStyleRoute(preciseStyleRoute),
        updated_at: new Date().toISOString(),
        updated_by: adminId,
      },
      { onConflict: "key" },
    )
  if (error) throw new Error(`Could not save ${NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY}: ${error.message}`)
  invalidateSettingsCache()
}

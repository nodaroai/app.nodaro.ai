/**
 * The `nodaro_motion_steps` row's admin read and write
 * (`nodaro-motion-steps.ts` defines and parses it). Lives in lib/, as the
 * other Nodaro Motion settings' stores do: app_settings is instance-global
 * config written with the service-role client.
 */
import { supabase } from "./supabase.js"
import { invalidateSettingsCache } from "./app-settings.js"
import { NODARO_MOTION_STEPS_KEY, parseNodaroMotionSteps, withEarlierStepsKeys, withoutEmptySteps, type NodaroMotionSteps } from "./nodaro-motion-steps.js"

/** The stored row, read fresh (not through the cache): what an admin screen shows. null = never saved. Throws on a database error. */
export async function readNodaroMotionSteps(): Promise<{ steps: NodaroMotionSteps | null; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", NODARO_MOTION_STEPS_KEY)
    .maybeSingle()
  if (error) throw new Error(`Could not read ${NODARO_MOTION_STEPS_KEY}: ${error.message}`)
  const row = data as { value?: unknown; updated_at?: string | null } | null
  return { steps: row ? parseNodaroMotionSteps(row.value) : null, updatedAt: row?.updated_at ?? null }
}

/**
 * Save the whole setting (already validated by `nodaroMotionStepsSaveSchema`),
 * empty entries left out, under the current AND the earlier engine keys (the
 * masking row's transition shim), and clear this process's settings cache;
 * the other servers see the save within about a second (app-settings-version.ts). Throws
 * on a database error.
 */
export async function saveNodaroMotionSteps(steps: NodaroMotionSteps, adminId: string): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: NODARO_MOTION_STEPS_KEY, value: withEarlierStepsKeys(withoutEmptySteps(steps)), updated_at: new Date().toISOString(), updated_by: adminId },
      { onConflict: "key" },
    )
  if (error) throw new Error(`Could not save ${NODARO_MOTION_STEPS_KEY}: ${error.message}`)
  invalidateSettingsCache()
}

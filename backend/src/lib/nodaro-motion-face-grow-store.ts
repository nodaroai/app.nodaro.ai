/**
 * The `nodaro_motion_face_grow` row's admin read and write
 * (`nodaro-motion-face-grow-setting.ts` defines and parses it). app_settings
 * is instance-global config written with the service-role client.
 */
import { supabase } from "./supabase.js"
import { invalidateSettingsCache } from "./app-settings.js"
import { NODARO_MOTION_FACE_GROW_KEY, parseNodaroMotionFaceGrow, withoutDefaultFaceGrow, type NodaroMotionFaceGrow } from "./nodaro-motion-face-grow-setting.js"

/** The stored row, read fresh (not through the cache). null = never saved. Throws on a database error. */
export async function readNodaroMotionFaceGrow(): Promise<{ faceGrow: NodaroMotionFaceGrow | null; updatedAt: string | null }> {
  const { data, error } = await supabase.from("app_settings").select("value, updated_at").eq("key", NODARO_MOTION_FACE_GROW_KEY).maybeSingle()
  if (error) throw new Error(`Could not read ${NODARO_MOTION_FACE_GROW_KEY}: ${error.message}`)
  const row = data as { value?: unknown; updated_at?: string | null } | null
  return { faceGrow: row ? parseNodaroMotionFaceGrow(row.value) : null, updatedAt: row?.updated_at ?? null }
}

/** Save the whole setting (validated), the zeros left out, and clear this process's settings cache. Throws on a database error. */
export async function saveNodaroMotionFaceGrow(faceGrow: NodaroMotionFaceGrow, adminId: string): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: NODARO_MOTION_FACE_GROW_KEY, value: withoutDefaultFaceGrow(faceGrow), updated_at: new Date().toISOString(), updated_by: adminId },
      { onConflict: "key" },
    )
  if (error) throw new Error(`Could not save ${NODARO_MOTION_FACE_GROW_KEY}: ${error.message}`)
  invalidateSettingsCache()
}

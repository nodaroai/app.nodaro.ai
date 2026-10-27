/**
 * The `nodaro_motion_prompt_parts` row's admin read and write
 * (`nodaro-motion-prompt-parts.ts` defines and parses it). Lives in lib/, as
 * the masking setting's store does: app_settings is instance-global config
 * written with the service-role client.
 */
import { supabase } from "./supabase.js"
import { invalidateSettingsCache } from "./app-settings.js"
import { NODARO_MOTION_PROMPT_PARTS_KEY, parseNodaroMotionPromptParts, type NodaroMotionPromptParts } from "./nodaro-motion-prompt-parts.js"

/** The stored row, read fresh (not through the cache): what an admin screen shows. Throws on a database error. */
export async function readNodaroMotionPromptParts(): Promise<{ promptParts: NodaroMotionPromptParts | null; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", NODARO_MOTION_PROMPT_PARTS_KEY)
    .maybeSingle()
  if (error) throw new Error(`Could not read ${NODARO_MOTION_PROMPT_PARTS_KEY}: ${error.message}`)
  const row = data as { value?: unknown; updated_at?: string | null } | null
  return { promptParts: row ? parseNodaroMotionPromptParts(row.value) : null, updatedAt: row?.updated_at ?? null }
}

/**
 * Save the whole setting (already validated by `nodaroMotionPromptPartsSchema`
 * and checked by the engine) and clear this process's settings cache. Written
 * under the current keys only: no app from before the 2026-10-26 rename reads
 * this row (the masking row's two-key write has no reason here). The worker
 * and the other servers converge on their own cache expiry (about 60 s).
 * Throws on a database error.
 */
export async function saveNodaroMotionPromptParts(promptParts: NodaroMotionPromptParts, adminId: string): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: NODARO_MOTION_PROMPT_PARTS_KEY, value: promptParts, updated_at: new Date().toISOString(), updated_by: adminId },
      { onConflict: "key" },
    )
  if (error) throw new Error(`Could not save ${NODARO_MOTION_PROMPT_PARTS_KEY}: ${error.message}`)
  invalidateSettingsCache()
}

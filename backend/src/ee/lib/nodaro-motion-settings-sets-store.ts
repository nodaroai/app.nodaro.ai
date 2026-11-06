/**
 * The `nodaro_motion_settings_sets` table (migration 606): Nodaro Motion's
 * stored settings sets, read and written with the service-role client by the
 * admin routes only (RLS on, no client grants).
 *
 * A table of its own, not `app_settings`: a set is never a live setting. Every
 * backend process reads `app_settings` into memory and re-reads it on each
 * write there (its version trigger, migration 605), and runs read settings
 * from it; a set kept there would be one more row every process carries and
 * one wrong key away from being read as live. Here nothing but this page
 * reads them.
 */
import { supabase } from "../../lib/supabase.js"
import type { NodaroMotionSettings } from "./nodaro-motion-settings-sets.js"

const TABLE = "nodaro_motion_settings_sets"
const COLUMNS = "id, name, format_version, settings, created_by, updated_by, created_at, updated_at, live_at"

export interface NodaroMotionSettingsSetRow {
  id: string
  name: string
  format_version: number
  settings: NodaroMotionSettings
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  /** When the live settings last matched this set, as the admin page saw them (null: never). */
  live_at: string | null
}

/** Another set already has this name (names are unique, case aside). */
export class SettingsSetNameTakenError extends Error {
  constructor(name: string) {
    super(`A stored set is already named "${name}".`)
    this.name = "SettingsSetNameTakenError"
  }
}

function failed(what: string, error: { message: string }): Error {
  return new Error(`Could not ${what} the Nodaro Motion settings sets: ${error.message}`)
}

function isNameTaken(error: { code?: string } | null): boolean {
  return error?.code === "23505"
}

/** Every stored set, by name. */
export async function listSettingsSets(): Promise<NodaroMotionSettingsSetRow[]> {
  const { data, error } = await supabase.from(TABLE).select(COLUMNS).order("name", { ascending: true })
  if (error) throw failed("read", error)
  return (data ?? []) as NodaroMotionSettingsSetRow[]
}

/** One stored set; null when there is none with that id. */
export async function getSettingsSet(id: string): Promise<NodaroMotionSettingsSetRow | null> {
  const { data, error } = await supabase.from(TABLE).select(COLUMNS).eq("id", id).maybeSingle()
  if (error) throw failed("read", error)
  return (data as NodaroMotionSettingsSetRow | null) ?? null
}

export async function createSettingsSet(input: { name: string; settings: NodaroMotionSettings; formatVersion: number; adminId: string }): Promise<NodaroMotionSettingsSetRow> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ name: input.name, settings: input.settings, format_version: input.formatVersion, created_by: input.adminId, updated_by: input.adminId })
    .select(COLUMNS)
    .single()
  if (isNameTaken(error)) throw new SettingsSetNameTakenError(input.name)
  if (error) throw failed("save", error)
  return data as NodaroMotionSettingsSetRow
}

/** A set renamed and/or overwritten; null when there is none with that id. */
export async function updateSettingsSet(
  id: string,
  input: { name?: string; settings?: NodaroMotionSettings; formatVersion?: number; adminId: string },
): Promise<NodaroMotionSettingsSetRow | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.settings !== undefined ? { settings: input.settings, format_version: input.formatVersion } : {}),
      updated_by: input.adminId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle()
  if (isNameTaken(error)) throw new SettingsSetNameTakenError(input.name ?? "")
  if (error) throw failed("save", error)
  return (data as NodaroMotionSettingsSetRow | null) ?? null
}

/** The set deleted, as it was; null when there is none with that id. */
export async function deleteSettingsSet(id: string): Promise<NodaroMotionSettingsSetRow | null> {
  const { data, error } = await supabase.from(TABLE).delete().eq("id", id).select(COLUMNS).maybeSingle()
  if (error) throw failed("delete", error)
  return (data as NodaroMotionSettingsSetRow | null) ?? null
}

/** Mark the set as the one the live settings match now (`live_at`); null when there is none with that id. */
export async function markSettingsSetLive(id: string): Promise<NodaroMotionSettingsSetRow | null> {
  const { data, error } = await supabase.from(TABLE).update({ live_at: new Date().toISOString() }).eq("id", id).select(COLUMNS).maybeSingle()
  if (error) throw failed("save", error)
  return (data as NodaroMotionSettingsSetRow | null) ?? null
}

/** The emails of the admins who saved sets, by id (an id with no profile is left out). */
export async function adminEmails(ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const { data, error } = await supabase.from("profiles").select("id, email").in("id", unique)
  if (error) throw failed("read", error)
  return new Map(((data ?? []) as Array<{ id: string; email: string | null }>).filter((p) => p.email).map((p) => [p.id, p.email!]))
}

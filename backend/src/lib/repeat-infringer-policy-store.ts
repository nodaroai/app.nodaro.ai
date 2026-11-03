/**
 * The `rights_repeat_infringer_policy` row's admin read and write
 * (repeat-infringer-policy.ts defines and parses it). app_settings is
 * instance-global config written with the service-role client.
 */
import { supabase } from "./supabase.js"
import { invalidateSettingsCache } from "./app-settings.js"
import { DEFAULT_REPEAT_INFRINGER_POLICY, REPEAT_INFRINGER_POLICY_KEY, parseRepeatInfringerPolicy, type RepeatInfringerPolicy } from "./repeat-infringer-policy.js"

export interface StoredRepeatInfringerPolicy {
  readonly policy: RepeatInfringerPolicy
  /** False: never saved, the default applies. */
  readonly saved: boolean
  readonly updatedAt: string | null
}

/** The stored policy, read fresh (not through the cache): what the admin screen shows. Throws on a database error. */
export async function readRepeatInfringerPolicy(): Promise<StoredRepeatInfringerPolicy> {
  const { data, error } = await supabase.from("app_settings").select("value, updated_at").eq("key", REPEAT_INFRINGER_POLICY_KEY).maybeSingle()
  if (error) throw new Error(`Could not read ${REPEAT_INFRINGER_POLICY_KEY}: ${error.message}`)
  const row = data as { value?: unknown; updated_at?: string | null } | null
  if (!row) return { policy: DEFAULT_REPEAT_INFRINGER_POLICY, saved: false, updatedAt: null }
  return { policy: parseRepeatInfringerPolicy(row.value), saved: true, updatedAt: row.updated_at ?? null }
}

/**
 * The policy as it reads now, fresh: the case shows the step the policy names
 * and a measure is checked against the same reading, whichever server answers
 * each (the settings cache of another server can lag a saved change by a
 * minute). Throws on a database error.
 */
export async function currentRepeatInfringerPolicy(): Promise<RepeatInfringerPolicy> {
  return (await readRepeatInfringerPolicy()).policy
}

/**
 * Saves the policy (already validated by `repeatInfringerPolicySchema`) and
 * clears this process's settings cache; the other servers follow on their own
 * cache expiry (about a minute). Throws on a database error.
 */
export async function saveRepeatInfringerPolicy(policy: RepeatInfringerPolicy, adminId: string): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: REPEAT_INFRINGER_POLICY_KEY, value: policy, updated_at: new Date().toISOString(), updated_by: adminId }, { onConflict: "key" })
  if (error) throw new Error(`Could not save ${REPEAT_INFRINGER_POLICY_KEY}: ${error.message}`)
  invalidateSettingsCache()
}

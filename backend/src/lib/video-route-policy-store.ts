/**
 * The admin reads and writes of `video_route_policy` and
 * `video_route_price_factors` (video-route-policy.ts defines and parses
 * them). app_settings is instance-global config, written with the
 * service-role client; every process sees a save on its next settings read
 * (app-settings-version.ts).
 */
import { supabase } from "./supabase.js"
import { getRuntimeEnv } from "./runtime-env.js"
import { invalidateSettingsCache } from "./app-settings.js"
import {
  videoRoutePolicyKey,
  videoRoutePriceFactorsKey,
  parseVideoRoutePolicy,
  parseVideoRoutePriceFactors,
  type VideoRoutePolicy,
  type VideoRoutePriceFactors,
} from "./video-route-policy.js"

async function readRow(key: string): Promise<{ value: unknown; updatedAt: string | null } | null> {
  const { data, error } = await supabase.from("app_settings").select("value, updated_at").eq("key", key).maybeSingle()
  if (error) throw new Error(`Could not read ${key}: ${error.message}`)
  const row = data as { value?: unknown; updated_at?: string | null } | null
  return row ? { value: row.value, updatedAt: row.updated_at ?? null } : null
}

async function writeRow(key: string, value: unknown, adminId: string | null): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key, value, updated_at: new Date().toISOString(), ...(adminId ? { updated_by: adminId } : {}) }, { onConflict: "key" })
  if (error) throw new Error(`Could not save ${key}: ${error.message}`)
  invalidateSettingsCache()
}

/** The stored policy, read fresh (not through the cache). null = never saved. Throws on a database error. */
export async function readVideoRoutePolicy(): Promise<{ policy: VideoRoutePolicy | null; updatedAt: string | null }> {
  const row = await readRow(videoRoutePolicyKey())
  return { policy: row ? parseVideoRoutePolicy(row.value) : null, updatedAt: row?.updatedAt ?? null }
}

/** Save the whole policy (already validated). Throws on a database error. */
export async function saveVideoRoutePolicy(policy: VideoRoutePolicy, adminId: string): Promise<void> {
  await writeRow(videoRoutePolicyKey(), policy, adminId)
}

/** The stored price factors, read fresh. Throws on a database error. */
export async function readVideoRoutePriceFactors(): Promise<{ factors: VideoRoutePriceFactors; updatedAt: string | null; raw: unknown }> {
  const row = await readRow(videoRoutePriceFactorsKey())
  return { factors: parseVideoRoutePriceFactors(row?.value), updatedAt: row?.updatedAt ?? null, raw: row?.value ?? null }
}

/** Save the whole factor table (an admin's edit or reset). Throws on a database error. */
export async function saveVideoRoutePriceFactors(factors: VideoRoutePriceFactors, adminId: string | null): Promise<void> {
  await writeRow(videoRoutePriceFactorsKey(), factors, adminId)
}

/** The daily reconciliation of the route's spend, kept per environment (ee/billing/video-route-watch.ts). */
/** The daily reconciliation's row, per environment (its value is that environment's days). */
export function videoRouteSpendDaysKey(env = getRuntimeEnv()): string {
  return `video_route_spend_days:${env}`
}

/** The stored row's raw value, read fresh. Throws on a database error. */
export async function readSettingsRowValue(key: string): Promise<unknown> {
  return (await readRow(key))?.value ?? null
}

/**
 * Rewrite one app_settings row with a compare-and-set on its `updated_at`, so
 * two processes writing at once never lose a write: the loser re-reads and
 * applies its change to the new value (a few attempts). `change` returns the
 * new value, or undefined for "no change". Returns the value written, or undefined.
 */
export async function updateSettingsRow(key: string, change: (current: unknown, updatedAt: string | null) => unknown): Promise<unknown> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await readRow(key)
    const value = change(row?.value ?? null, row?.updatedAt ?? null)
    if (value === undefined) return undefined
    const now = new Date().toISOString()
    if (!row) {
      const { error } = await supabase.from("app_settings").insert({ key, value, updated_at: now })
      if (!error) {
        invalidateSettingsCache()
        return value
      }
      continue // someone inserted first: read again
    }
    let query = supabase.from("app_settings").update({ value, updated_at: now }).eq("key", key)
    query = row.updatedAt === null ? query.is("updated_at", null) : query.eq("updated_at", row.updatedAt)
    const { data, error } = await query.select("key")
    if (error) throw new Error(`Could not save ${key}: ${error.message}`)
    if (Array.isArray(data) && data.length > 0) {
      invalidateSettingsCache()
      return value
    }
  }
  throw new Error(`Could not save ${key}: it kept changing under this write`)
}

/**
 * Change ONE price factor (a compare-and-set on the factor row, `updateSettingsRow`).
 * `change` returns the new entry, or null for "no change". Returns the entry written, or null.
 */
export async function updateVideoRoutePriceFactor(
  key: string,
  change: (current: VideoRoutePriceFactors[string] | undefined) => VideoRoutePriceFactors[string] | null,
): Promise<VideoRoutePriceFactors[string] | null> {
  let written: VideoRoutePriceFactors[string] | null = null
  await updateSettingsRow(videoRoutePriceFactorsKey(), (raw) => {
    const factors = parseVideoRoutePriceFactors(raw)
    const next = change(factors[key])
    written = next
    return next ? { ...factors, [key]: next } : undefined
  })
  return written
}

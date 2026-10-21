import { supabase } from "../../lib/supabase.js"
import { hasCredits } from "../../lib/config.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import type { PluginSupports } from "../../lib/private-plugins/types.js"

/**
 * Engine environments (Trends, spec D17): staging and production share one
 * database but each pins its own `@nodaroai/cloud-plugins` build, so what the
 * Cast Swap engine supports has one answer per environment. Each API server
 * records its own at boot (`recordThisEngineEnvironment`, called from
 * `app.ts` after the plugins load), and publishing a trend checks every
 * environment in `TREND_PUBLISH_ENVIRONMENTS` (`listEngineEnvironments`).
 *
 * Table `engine_environments` (migration 548): server-only, service role.
 */

/** The environments whose engine must support a trend before it is published. */
export const TREND_PUBLISH_ENVIRONMENTS = ["staging", "production"] as const

export interface EngineEnvironment {
  env: string
  pluginBuildId: string | null
  supports: PluginSupports
  updatedAt: string
}

/** The table's own check on `env`: a name it would refuse is not written. */
const ENV_NAME = /^[a-z0-9-]{1,40}$/

/**
 * Upsert this environment's row. `updated_at` is written here: the column's
 * default fires on insert only, and a re-boot must move it. Throws on a
 * database error.
 */
export async function recordEngineEnvironment(input: {
  env: string
  pluginBuildId: string | null
  supports: PluginSupports
}): Promise<void> {
  const { error } = await supabase.from("engine_environments").upsert(
    {
      env: input.env,
      plugin_build_id: input.pluginBuildId,
      supports: input.supports,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "env" },
  )
  if (error) throw new Error(`Failed to record engine environment ${input.env}: ${error.message}`)
}

/**
 * Every recorded environment. Throws on a database error: the publish check
 * must never read an outage as "no environment supports it" (or as "none to
 * check").
 */
export async function listEngineEnvironments(): Promise<EngineEnvironment[]> {
  const { data, error } = await supabase
    .from("engine_environments")
    .select("env, plugin_build_id, supports, updated_at")
    .order("env", { ascending: true })
  if (error) throw new Error(`Failed to read engine environments: ${error.message}`)
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    env: row.env as string,
    pluginBuildId: (row.plugin_build_id as string | null) ?? null,
    supports: (row.supports as PluginSupports | null) ?? {},
    updatedAt: row.updated_at as string,
  }))
}

/**
 * The boot hook: on a cloud install that knows its Railway environment,
 * record what this process's loaded plugins support. Never rejects — boot
 * must not wait on it or fail because of it — so the caller can fire and
 * forget. Reads `RAILWAY_ENVIRONMENT_NAME` at call time.
 */
export async function recordThisEngineEnvironment(pluginBuildId: string | null): Promise<void> {
  if (!hasCredits()) return
  const env = process.env.RAILWAY_ENVIRONMENT_NAME?.trim()
  if (!env) return
  if (!ENV_NAME.test(env)) {
    console.warn(`[engine-environments] not recording environment "${env}": not a valid environment name`)
    return
  }
  try {
    await recordEngineEnvironment({ env, pluginBuildId, supports: getPluginSupports() })
  } catch (err) {
    console.error("[engine-environments] could not record this environment's engine:", err)
  }
}

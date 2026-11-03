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
 * Beside that engine record, each environment's PLATFORM (the app itself)
 * claims what it takes of the data they share (`PlatformSupports`), so a value
 * only a newer app reads waits until every environment runs one (decided
 * 2026-11-03, "beat only the claim"). The claim is two columns of its own
 * (`platform_supports`, `platform_claimed_at`, migration 592), written only by
 * the listening API server's heartbeat (`startPlatformClaimHeartbeat`, from
 * `server.ts`) as an update of those two alone, and it counts only while its
 * own time is fresh (`platformOf`, `PLATFORM_CLAIM_TTL_MS`). So a beat never
 * rewrites the engine record, and a boot write never touches the claim.
 *
 * Table `engine_environments` (migrations 548, 592): server-only, service role.
 */

/** The environments whose engine must support a trend before it is published. */
export const TREND_PUBLISH_ENVIRONMENTS = ["staging", "production"] as const

/**
 * What THIS platform (the app itself, apart from its engine plugin) takes of
 * the data every environment shares, claimed in this environment's row by the
 * heartbeat (decided 2026-11-03). Staging and production share one database but
 * can run different app versions: a value only a newer app reads (an older
 * one's strict schemas refuse it, or key a stored clip without it) is saved
 * only once every environment's platform claims that it takes it. A platform
 * from before the claim makes none: it takes nothing listed here. Each key is a
 * fact about this build: add one WITH the reads it describes.
 */
export interface PlatformSupports {
  /**
   * Full depth's smallest face with mesh lines (`faceMasking.faceMeshMinFaceHeightPct`):
   * its schemas take it, its stored clips' settings key hashes it, and it is
   * sent to an engine that declares it (lib/cast-swap-face-masking.ts).
   */
  readonly faceMeshMinFaceHeightPct?: boolean
}

/** This build's `PlatformSupports`, claimed by the heartbeat (frozen: a fact about this build). */
export const PLATFORM_SUPPORTS: PlatformSupports = Object.freeze({ faceMeshMinFaceHeightPct: true })

/**
 * An environment's platform claim as its heartbeat last wrote it: what its
 * platform takes (`platform_supports`) and when it said so
 * (`platform_claimed_at`). Read it only through `platformOf`, which applies the
 * TTL.
 */
export interface PlatformClaim {
  readonly supports: PlatformSupports
  readonly at: string
}

export interface EngineEnvironment {
  env: string
  pluginBuildId: string | null
  /** The engine record: what its loaded plugins declared at boot. */
  supports: PluginSupports
  /** When the engine record was written: the latest boot of a process there. */
  updatedAt: string
  /** Its platform claim; absent: none (a platform from before it, or the claim's columns not in the database yet). */
  platformClaim?: PlatformClaim
}

/**
 * An environment as the admin reads it (`GET /v1/admin/trends/engine-environments`,
 * `withFreshPlatform`): the engine record, with the platform claim in
 * `supports.platform` only while it is fresh.
 */
export interface EngineEnvironmentView {
  env: string
  pluginBuildId: string | null
  supports: PluginSupports & { readonly platform?: PlatformSupports }
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
  // Every column, not a list: the claim's columns (migration 592) reach the database only with the promote to main,
  // while staging already runs this code, and a list naming them would fail every engine check there until then.
  // Without them a row simply has no claim.
  const { data, error } = await supabase
    .from("engine_environments")
    .select("*")
    .order("env", { ascending: true })
  if (error) throw new Error(`Failed to read engine environments: ${error.message}`)
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const recorded: EngineEnvironment = {
      env: row.env as string,
      pluginBuildId: (row.plugin_build_id as string | null) ?? null,
      supports: engineSupportsOf(row.supports),
      updatedAt: row.updated_at as string,
    }
    const claim = platformClaimOf(row.platform_supports, row.platform_claimed_at)
    return claim ? { ...recorded, platformClaim: claim } : recorded
  })
}

/**
 * The engine record's supports as recorded (none: `{}`), less a `platform`
 * key should one be there: a claim is only ever the claim's own columns, and
 * the admin's view puts a fresh one in that place (`withFreshPlatform`).
 */
function engineSupportsOf(raw: unknown): PluginSupports {
  const supports = (raw as Record<string, unknown> | null) ?? {}
  if (!Object.hasOwn(supports, "platform")) return supports as PluginSupports
  const engine = { ...supports }
  delete engine.platform
  return engine as PluginSupports
}

/** A claim from its two columns: both there, its supports an object, its time a string; anything else is none. */
function platformClaimOf(supports: unknown, at: unknown): PlatformClaim | undefined {
  if (typeof at !== "string" || supports === null || typeof supports !== "object" || Array.isArray(supports)) return undefined
  return { supports: supports as PlatformSupports, at }
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

/**
 * How often the listening API server claims what its platform takes while it
 * runs (decided 2026-11-03): one small update per instance every 5 minutes,
 * each moving the claim's own time (`platform_claimed_at`).
 */
export const PLATFORM_CLAIM_INTERVAL_MS = 5 * 60 * 1000

/**
 * How long a platform claim counts after the beat that made it: 15 minutes,
 * three missed beats (decided 2026-11-03). A failed deploy, a crashed app, a
 * process stopped by SIGTERM or a rollback to a build without the heartbeat
 * stops the beats, and the claim lapses within one TTL: the hold closes by
 * itself.
 */
export const PLATFORM_CLAIM_TTL_MS = 15 * 60 * 1000

/**
 * Whether a claim made at `at` is fresh enough to count: within
 * `PLATFORM_CLAIM_TTL_MS` of `now`, either way (a clock a little ahead is no
 * reason to refuse, one far ahead no reason to trust). An unreadable time is
 * not fresh: fail closed.
 */
export function platformClaimFresh(at: string, now: number = Date.now()): boolean {
  const time = Date.parse(at)
  return Number.isFinite(time) && Math.abs(now - time) <= PLATFORM_CLAIM_TTL_MS
}

/**
 * THE reader of a platform claim: what the environment's platform takes, while
 * its claim is fresh by the claim's OWN time (`platformClaimFresh`), whatever
 * the engine record's age; none from a stale claim, no claim, or no row. A
 * stale claim is no claim, so every hold fails closed when the platform that
 * made it stops beating.
 */
export function platformOf(env: EngineEnvironment | undefined, now: number = Date.now()): PlatformSupports | undefined {
  const claim = env?.platformClaim
  return claim && platformClaimFresh(claim.at, now) ? claim.supports : undefined
}

/**
 * The environment as the admin reads it (`GET /v1/admin/trends/engine-environments`):
 * the engine record as recorded (`updatedAt`, "Reported": its boot), with the
 * platform claim as `supports.platform` only while it is fresh (`platformOf`),
 * so the editor greys out on the server's clock, never the browser's. Nothing
 * else of the claim is sent. A new object; the environment is not changed.
 */
export function withFreshPlatform(env: EngineEnvironment, now: number = Date.now()): EngineEnvironmentView {
  const platform = platformOf(env, now)
  return {
    env: env.env,
    pluginBuildId: env.pluginBuildId,
    supports: platform ? { ...env.supports, platform } : env.supports,
    updatedAt: env.updatedAt,
  }
}

/**
 * The heartbeat's write: an update of this environment's claim columns
 * (`platform_supports`, `platform_claimed_at`) and of nothing else, so it can
 * never change the engine record its boot write owns. It never inserts: with
 * no row yet (its boot write not in) there is nothing to claim on. Throws on a
 * database error (the claim's columns not in the database yet among them) and
 * when no row matched.
 */
export async function recordPlatformClaim(env: string, claim: PlatformSupports): Promise<void> {
  const { data, error } = await supabase
    .from("engine_environments")
    .update({ platform_supports: claim, platform_claimed_at: new Date().toISOString() })
    .eq("env", env)
    .select("env")
  if (error) throw new Error(`Failed to record the platform claim of ${env}: ${error.message}`)
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`Failed to record the platform claim of ${env}: it has no engine record yet (its boot write makes one)`)
  }
}

/**
 * This environment's name when its platform claims here: the boot write's (a
 * cloud install that knows its Railway environment, by a name the table
 * takes), silently, since the boot write warns about a name it refuses. Else
 * null: nothing to claim.
 */
function environmentToClaim(): string | null {
  if (!hasCredits()) return null
  const env = process.env.RAILWAY_ENVIRONMENT_NAME?.trim()
  return env && ENV_NAME.test(env) ? env : null
}

/**
 * The platform claim's heartbeat (decided 2026-11-03, "beat only the claim"),
 * started by the API server once it LISTENS and stopped first thing on
 * SIGTERM (server.ts): claims `PLATFORM_SUPPORTS` for this environment at
 * once, then every `intervalMs` while the process runs (`recordPlatformClaim`:
 * the claim's two columns alone), so a claim lasts only as long as a process
 * of this build that serves. The engine record is never touched here: the
 * boot write owns it.
 *
 * Nothing to claim (not cloud, no or an invalid Railway name): no write and no
 * interval at all. It never throws into the app: a failed beat is logged once
 * (until one succeeds again) and the next beat tries again; a beat still
 * writing when the next is due is not doubled. The timer is `unref`'d, so it
 * never holds the process open. Returns the stop: no beat starts after it (one
 * already in flight still lands, and its claim lapses within the TTL).
 */
export function startPlatformClaimHeartbeat(opts: { intervalMs?: number } = {}): () => void {
  const env = environmentToClaim()
  if (!env) return () => {}
  let writing = false
  let failing = false
  let stopped = false
  const beat = async (): Promise<void> => {
    if (writing || stopped) return
    writing = true
    try {
      await recordPlatformClaim(env, PLATFORM_SUPPORTS)
      failing = false
    } catch (err) {
      if (!failing) console.error("[engine-environments] could not record this platform's claim (the heartbeat goes on; said once until a beat succeeds):", err)
      failing = true
    } finally {
      writing = false
    }
  }
  void beat()
  const timer = setInterval(() => void beat(), opts.intervalMs ?? PLATFORM_CLAIM_INTERVAL_MS)
  timer.unref?.()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}

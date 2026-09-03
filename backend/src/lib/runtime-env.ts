/**
 * Which deployment is this process? — one source of truth, no I/O.
 *
 * Staging (`next.nodaro.ai`) and production (`app.nodaro.ai`) share ONE
 * Supabase database but have SEPARATE Redis instances, so each environment
 * runs its own BullMQ `workflow-orchestration` queue. Both environments'
 * reconcile sweeps scan the SAME `workflow_executions` rows and look the
 * orchestrator job up in THEIR OWN Redis — so before this module existed,
 * every execution of the other environment looked orphaned and got marked
 * failed mid-run (verified live: a staging run killed by production's cron
 * 2m38s after it started, while its nodes were still progressing, and the
 * in-flight generation it had already paid for was never delivered).
 *
 * The fix: `workflow_executions.runtime_env` records which environment's
 * orchestrator claimed the row (migration 374), and every sweep scopes its
 * scan through `scopeToRuntimeEnv` below.
 *
 * Deliberately Redis-free and import-free: the boot sweep in
 * `workers/orchestrator-worker.ts` and the cron in `lib/reconcile/` both
 * read it, and neither may pull a queue connection in through this path.
 */

/**
 * The one environment that also reconciles LEGACY rows — those claimed
 * before migration 374, whose `runtime_env` is NULL. A legacy row can only
 * have been claimed by an older production or staging build; production is
 * where an abandoned row costs a user real money, and staging's stale legacy
 * rows are harmless, so production takes them. Both environments touching
 * them would reintroduce the exact cross-environment kill this module fixes.
 */
export const PRODUCTION_RUNTIME_ENV = "production"

/**
 * The PostgREST `or` predicate production scans with: its own rows plus the
 * pre-374 legacy rows. Exported so the sweeps and their tests share one
 * string instead of two hand-written copies that can drift.
 */
export const LEGACY_PRODUCTION_SCAN_FILTER = "runtime_env.eq.production,runtime_env.is.null"

/** What a process with neither variable set calls itself (self-host, dev). */
export const DEFAULT_RUNTIME_ENV = "local"

/**
 * The runtime environment's name.
 *
 * `RUNTIME_ENV` is the explicit override (self-hosters, docker-compose, and
 * anyone running two installs against one database); `RAILWAY_ENVIRONMENT_NAME`
 * is what Railway injects on its own (`production` / `staging`). A blank value
 * counts as unset — a `RUNTIME_ENV=` line in a compose `.env` file must not
 * scope every sweep to the empty string.
 *
 * Read at CALL time, never memoized: tests vary it per case, and a memoized
 * value would silently outlive an env change.
 */
export function getRuntimeEnv(): string {
  const explicit = process.env.RUNTIME_ENV?.trim()
  if (explicit) return explicit
  const railway = process.env.RAILWAY_ENVIRONMENT_NAME?.trim()
  if (railway) return railway
  return DEFAULT_RUNTIME_ENV
}

/** The slice of the PostgREST filter builder the sweeps need. */
export interface RuntimeEnvScopableQuery {
  eq(column: string, value: string): this
  or(filters: string): this
}

/**
 * Narrow a `workflow_executions` scan to the rows this environment owns.
 *
 * The ONE place the scope predicate is decided — both the boot sweep and the
 * 90-second cron call it, so they cannot drift apart into "one environment
 * still kills the other's executions".
 */
export function scopeToRuntimeEnv<Q extends RuntimeEnvScopableQuery>(
  query: Q,
  env: string = getRuntimeEnv(),
): Q {
  if (env === PRODUCTION_RUNTIME_ENV) return query.or(LEGACY_PRODUCTION_SCAN_FILTER)
  return query.eq("runtime_env", env)
}

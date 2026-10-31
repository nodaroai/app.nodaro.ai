// backend/src/ee/routes/admin-lanes.ts — Admin configuration of concurrency
// lanes: each plan's sizes, per-account overrides, the providers' platform
// ceilings, the two waiting limits, and the `lanes_enforced` switch.
//
// Sizes, overrides, ceilings and the waiting limits live in the shared
// database, so an edit here applies to every environment that reads it
// (staging and production share one); only the switch is per environment.
// They exist on Cloud only (the per-plan table): elsewhere those PUTs are not
// registered (404) and GET answers `editable: false` with the env sizes. The
// switch is in every edition with an admin.
//
// Every write is operator-only (requirePlatformOperator): on a deployment-payer
// instance a size, a ceiling or the switch decides how much of the payer's
// credits and the platform's provider capacity a customer's users spend at
// once, so the customer's own admins must not change it.
//
// Live usage (every edition with an admin): what this environment's lanes
// hold right now (`/live`), one user's entries and days (`/users/:id`), the
// daily history (`/history`), and cancelling a queued job on its owner's
// behalf. The reads carry addresses and what people run, so they answer an
// admin signed in to the app only (never an API or app token), and never list
// the deployment's payer account except to itself, as on the users page.
import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { config, hasCredits } from "../../lib/config.js"
import { cancelOwnedJob, cancelRunningChildJobs } from "../../lib/cancel-job.js"
import { deploymentPayerId } from "../../lib/deployment-payer.js"
import { noteLaneColumnError } from "../../lib/concurrency-lanes/columns.js"
import { undeclaredPluginJobTypes } from "../../lib/concurrency-lanes/registry.js"
import { LANE_GATE_CALL_TIMEOUT_MS, LANE_KEY_PREFIX } from "../../lib/concurrency-lanes/gate.js"
import { invalidateBalanceCache } from "../billing/balance-cache.js"
import { createProfileLookup, LiveUsage, type LiveUsageDeps } from "../concurrency-lanes/live-usage.js"
import {
  HISTORY_DEFAULT_DAYS,
  HISTORY_MAX_DAYS,
  providersHistory,
  userHistory,
  usersHistory,
  type HistoryReadDeps,
} from "../concurrency-lanes/history-read.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { getRuntimeEnv } from "../../lib/runtime-env.js"
import { supabase } from "../../lib/supabase.js"
import { LANE_PLAN_TIERS } from "../../lib/concurrency-lanes/defaults.js"
import {
  enforcementPreconditions,
  lanesEnforcementAvailable,
  LanesNotAvailableError,
  readLanesEnforcedSetting,
  setLanesEnforced,
  unmetPreconditions,
} from "../../lib/concurrency-lanes/enforcement.js"
import { concurrencyGate } from "../../lib/concurrency-lanes/instance.js"
import { laneSettings, lanesEnforced, providerCeilings, providerCeilingsForGate } from "../../lib/concurrency-lanes/sizes.js"
import type { LaneSizes } from "../../lib/concurrency-lanes/types.js"
import {
  cloudLaneOverrides,
  cloudPlanSizes,
  invalidateLaneConfigCache,
  LANE_LIVE_WAIT_KEY,
  LANE_LIVE_WAIT_RANGE,
  LANE_QUEUE_TIMEOUT_KEY,
  LANE_QUEUE_TIMEOUT_RANGE,
  LANE_SIZE_RANGE,
  readStoredLaneOverride,
  type StoredLaneOverride,
} from "../concurrency-lanes/plan-sizes.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { requirePlatformOperator } from "../middleware/require-platform-operator.js"

const MINUTE_MS = 60_000
const LANES = ["provider", "llm", "local", "run"] as const
/** The most a provider ceiling may be (568 only asks for ≥ 1; this keeps a typo out of INT range). */
const CEILING_MAX = 100_000
const CEILING_RANGE = { min: 1, max: CEILING_MAX } as const

/** What each write accepts, served by GET /config so the Admin page checks the same bounds without a copy. */
const CONFIG_BOUNDS = {
  laneSize: LANE_SIZE_RANGE,
  providerCeiling: CEILING_RANGE,
  queueTimeoutMinutes: LANE_QUEUE_TIMEOUT_RANGE,
  liveWaitMinutes: LANE_LIVE_WAIT_RANGE,
} as const
const NOTE_MAX = 500

const laneSize = z.number().int().min(LANE_SIZE_RANGE.min).max(LANE_SIZE_RANGE.max)

const planBody = z.object({ provider: laneSize, llm: laneSize, local: laneSize, run: laneSize }).strict()
const tierParams = z.object({ tier: z.enum(LANE_PLAN_TIERS) })

const providerParams = z.object({ provider: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/) })
const ceilingBody = z.object({ ceiling: z.number().int().min(CEILING_RANGE.min).max(CEILING_RANGE.max).nullable() }).strict()

const userParams = z.object({ id: z.string().uuid() })
/** A full replacement: a lane left out or null follows the plan; all four null deletes the override. */
const overrideBody = z.object({
  provider: laneSize.nullable().optional(),
  llm: laneSize.nullable().optional(),
  local: laneSize.nullable().optional(),
  run: laneSize.nullable().optional(),
  note: z.string().max(NOTE_MAX).nullable().optional(),
}).strict()

const settingsBody = z.object({
  queueTimeoutMinutes: z.number().int().min(LANE_QUEUE_TIMEOUT_RANGE.min).max(LANE_QUEUE_TIMEOUT_RANGE.max),
  liveWaitMinutes: z.number().int().min(LANE_LIVE_WAIT_RANGE.min).max(LANE_LIVE_WAIT_RANGE.max),
}).strict()

const enforcedBody = z.object({ on: z.boolean(), confirmUnmet: z.boolean().optional() }).strict()

function invalid(error: z.ZodError): { error: { code: "validation_error"; message: string } } {
  const issue = error.issues[0]
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : ""
  return { error: { code: "validation_error", message: `${where}${issue?.message ?? "invalid request"}` } }
}

/** The env sizes of every line where there are no plans (Community / Business). */
function envLaneSizes(): LaneSizes {
  return {
    provider: config.LANE_PROVIDER_PER_USER,
    llm: config.LANE_LLM_PER_USER,
    local: config.LANE_LOCAL_PER_USER,
    run: config.LANE_RUN_PER_USER,
  }
}

/** The refusal of an "on" while concurrency limits cannot be turned on in this release. */
function notAvailableYet(): { error: { code: "not_available_yet"; message: string }; available: false } {
  return {
    error: { code: "not_available_yet", message: "Concurrency limits cannot be turned on yet in this release." },
    available: false,
  }
}

/**
 * How long one user's days are kept for the drawer, which asks every few
 * seconds: the history changes once a minute at most (the flush), so a re-read
 * of 30 days on every refresh would buy nothing.
 */
export const USER_HISTORY_TTL_MS = 60_000
const USER_HISTORY_MAX_ENTRIES = 500

/** The page asks every few seconds; this only bounds a runaway client. */
const LIVE_LIMIT = { rateLimit: { max: 60, timeWindow: "1 minute" } }

const IN_APP_ONLY = {
  error: { code: "in_app_only", message: "Live usage lists people and what they run, so it answers only an admin signed in to the app." },
}
const NO_SUCH_USER = { error: { code: "not_found", message: "No such user" } }
const NOT_THIS_ENVIRONMENT = {
  error: { code: "not_this_environment", message: "This job is not waiting in this environment's lanes; cancel it where it waits." },
}

const jobParams = z.object({ jobId: z.string().uuid() })
const historyQuery = z.object({
  // Longer windows are clamped to what the history keeps.
  days: z.coerce.number().int().min(1).optional().transform((d) => Math.min(d ?? HISTORY_DEFAULT_DAYS, HISTORY_MAX_DAYS)),
  view: z.enum(["users", "providers"]).default("users"),
}).strict()

/** The deployment's payer account when the caller is not that account: hidden from it. */
function hiddenPayerFor(req: FastifyRequest): string | null {
  const payerId = deploymentPayerId()
  return payerId !== null && payerId !== req.userId ? payerId : null
}

export interface AdminLanesRoutesOptions {
  /** Test seams for Live usage; production uses this process's gate, Redis and database. */
  live?: Partial<LiveUsageDeps>
}

/** This environment's switch: the setting, or the gate's flag when the database cannot be read. */
async function enforcedNow(): Promise<boolean> {
  try {
    return await readLanesEnforcedSetting()
  } catch {
    return lanesEnforced()
  }
}

export async function adminLanesRoutes(app: FastifyInstance, opts: AdminLanesRoutesOptions = {}): Promise<void> {
  // ------------------------------------------------------------ config
  app.get("/v1/admin/lanes/config", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const editable = hasCredits()
      const [plans, ceilings, settings, enforced, preconditions] = await Promise.all([
        editable ? cloudPlanSizes() : Promise.resolve({} as Record<string, LaneSizes>),
        providerCeilings(),
        laneSettings(),
        enforcedNow(),
        enforcementPreconditions(),
      ])
      return {
        plans,
        envSizes: editable ? null : envLaneSizes(),
        providerCeilings: ceilings,
        settings: {
          queueTimeoutMinutes: Math.round(settings.queueTimeoutMs / MINUTE_MS),
          liveWaitMinutes: Math.round(settings.liveWaitLimitMs / MINUTE_MS),
          liveWaitMaxMinutes: LANE_LIVE_WAIT_RANGE.max,
        },
        enforced,
        // false: limits cannot be turned on in this release (the switch refuses on).
        available: preconditions.available,
        preconditions,
        unmet: unmetPreconditions(preconditions),
        editable,
        env: getRuntimeEnv(),
        sharedAcrossEnvironments: true,
        bounds: CONFIG_BOUNDS,
      }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to read the lane configuration")
    }
  })

  // ------------------------------------------------------------ switch
  app.put("/v1/admin/lanes/enforced", { preHandler: requirePlatformOperator }, async (req, reply) => {
    const body = enforcedBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send(invalid(body.error))
    const { on, confirmUnmet } = body.data
    // Not in this release: refused before the preconditions are read, confirmed
    // or not, and nothing is written. Turning limits off is always allowed.
    if (on && !lanesEnforcementAvailable()) return reply.status(409).send(notAvailableYet())
    try {
      if (on) {
        const preconditions = await enforcementPreconditions()
        const unmet = unmetPreconditions(preconditions)
        if (unmet.length > 0 && confirmUnmet !== true) {
          return reply.status(409).send({
            error: { code: "preconditions_unmet", message: "Some preconditions are not met; confirm to turn lanes on anyway." },
            preconditions,
            unmet,
          })
        }
      }
      const result = await setLanesEnforced(on, req.userId as string)
      return { enforced: on, env: getRuntimeEnv(), woke: result.woke, mirrored: result.mirrored }
    } catch (err) {
      if (err instanceof LanesNotAvailableError) return reply.status(409).send(notAvailableYet())
      return sendInternalError(reply, req, err, "Failed to change the lane switch")
    }
  })

  // ------------------------------------------------------- live usage
  const over = opts.live ?? {}
  const plans = hasCredits()
  const profiles = over.profiles ?? createProfileLookup({ db: supabase, plans })
  const onProfileError = (err: unknown) => app.log.warn({ err }, "Live usage: could not read names; the page shows ids")
  const live = new LiveUsage({
    snapshot: over.snapshot ?? (() => concurrencyGate().snapshot()),
    redis: over.redis ?? (async () => (await import("../../lib/queue.js")).redis),
    profiles,
    overrides: over.overrides ?? cloudLaneOverrides,
    plans: over.plans ?? plans,
    undeclaredPluginTypes: over.undeclaredPluginTypes ?? undeclaredPluginJobTypes,
    available: over.available ?? lanesEnforcementAvailable,
    env: over.env ?? getRuntimeEnv,
    now: over.now ?? Date.now,
    prefix: over.prefix ?? LANE_KEY_PREFIX,
    callTimeoutMs: over.callTimeoutMs ?? LANE_GATE_CALL_TIMEOUT_MS,
    onProfileError,
  })
  const history: HistoryReadDeps = { db: supabase, env: over.env ?? getRuntimeEnv, now: over.now ?? Date.now, profiles, onProfileError }
  // One user's days per (user, viewer's hidden payer), kept USER_HISTORY_TTL_MS;
  // the oldest entry goes first past USER_HISTORY_MAX_ENTRIES. A failed read is not kept.
  const userDays = new Map<string, { at: number; value: Awaited<ReturnType<typeof userHistory>> }>()
  const cachedUserHistory = async (userId: string, hiddenUserId: string | null) => {
    const key = `${userId}|${hiddenUserId ?? ""}`
    const at = history.now()
    const hit = userDays.get(key)
    if (hit && at - hit.at < USER_HISTORY_TTL_MS) return hit.value
    const value = await userHistory(history, userId, HISTORY_DEFAULT_DAYS, hiddenUserId)
    userDays.delete(key)
    userDays.set(key, { at, value })
    if (userDays.size > USER_HISTORY_MAX_ENTRIES) userDays.delete(userDays.keys().next().value as string)
    return value
  }

  app.get("/v1/admin/lanes/live", { preHandler: requireAdmin, config: LIVE_LIMIT }, async (req, reply) => {
    if (req.authKind !== "jwt") return reply.status(403).send(IN_APP_ONLY)
    try {
      return await live.live({ hiddenUserId: hiddenPayerFor(req) })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to read live lane usage")
    }
  })

  app.get("/v1/admin/lanes/users/:id", { preHandler: requireAdmin, config: LIVE_LIMIT }, async (req, reply) => {
    if (req.authKind !== "jwt") return reply.status(403).send(IN_APP_ONLY)
    const params = userParams.safeParse(req.params)
    if (!params.success) return reply.status(400).send(invalid(params.error))
    const hiddenUserId = hiddenPayerFor(req)
    if (params.data.id === hiddenUserId) return reply.status(404).send(NO_SUCH_USER)
    try {
      // The lanes live in Redis, the days and the override in the database:
      // each answers without the others. The override is read from its table,
      // so the editor has it whether or not the user has anything running.
      const [entries, days, own] = await Promise.all([
        concurrencyGate().userEntries(params.data.id).catch((err: unknown) => {
          req.log.warn({ err }, "Live usage: could not read the user's lanes; answering the history only")
          return null
        }),
        cachedUserHistory(params.data.id, hiddenUserId),
        plans
          ? readStoredLaneOverride(params.data.id).catch((err: unknown): StoredLaneOverride | null => {
            req.log.warn({ err }, "Live usage: could not read the user's override")
            return null
          })
          : Promise.resolve(null),
      ])
      const user = await live.user(params.data.id, entries ?? [], { hiddenUserId })
      if (!user) return reply.status(404).send(NO_SUCH_USER)
      return {
        ...user,
        env: history.env(),
        linesAvailable: entries !== null,
        // Cloud only (null elsewhere, or when it could not be read): the user's own override row.
        own,
        history: { days: HISTORY_DEFAULT_DAYS, available: days.available, rows: days.days },
      }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to read the user's lanes")
    }
  })

  app.get("/v1/admin/lanes/history", { preHandler: requireAdmin, config: LIVE_LIMIT }, async (req, reply) => {
    if (req.authKind !== "jwt") return reply.status(403).send(IN_APP_ONLY)
    const query = historyQuery.safeParse(req.query ?? {})
    if (!query.success) return reply.status(400).send(invalid(query.error))
    try {
      return query.data.view === "providers"
        ? await providersHistory(history, query.data.days)
        : await usersHistory(history, query.data.days, hiddenPayerFor(req))
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to read the lane history")
    }
  })

  // Cancel a queued job on its owner's behalf, through the owner's own cancel
  // path (cancelOwnedJob: out of its lane and its queue, then refunded; then
  // its running children), exactly as POST /v1/jobs/:jobId/cancel does.
  // Only a job waiting for a slot: a running one is its owner's to stop.
  app.post("/v1/admin/lanes/jobs/:jobId/cancel", { preHandler: requirePlatformOperator }, async (req, reply) => {
    const params = jobParams.safeParse(req.params)
    if (!params.success) return reply.status(400).send(invalid(params.error))
    const { jobId } = params.data
    try {
      const { data: row, error } = await supabase
        .from("jobs") // tenant-scope-ignore: an operator acts for the job's owner, read here
        .select("id, user_id, status, lane_env, lane_env_id")
        .eq("id", jobId)
        .maybeSingle()
      // Without the lane columns no job was ever parked by a lane: nothing here to cancel.
      if (error && noteLaneColumnError("jobs", error)) return reply.status(409).send(NOT_THIS_ENVIRONMENT)
      if (error) return sendInternalError(reply, req, error, "Failed to cancel the job")
      const job = row as { user_id?: string; status?: string; lane_env?: string | null; lane_env_id?: string | null } | null
      if (!job?.user_id || job.user_id === hiddenPayerFor(req)) {
        return reply.status(404).send({ error: { code: "not_found", message: "Job not found" } })
      }
      // A separate read from cancelOwnedJob's own: a job that starts in between
      // is refused there (in_flight, or flipped and refunded before its provider
      // call, as when its owner cancels it).
      if (job.status !== "queued") {
        return reply.status(409).send({ error: { code: "not_queued", message: `Only a job waiting for a slot can be cancelled here (status: ${job.status})` } })
      }
      // Staging and production share the database but not their Redis: a job
      // another environment parked waits in that environment's line and queue,
      // which a cancel here cannot reach. Only the environment that stamped the
      // row (lane_env, lane_env_id — as the queued sweep scopes it) cancels it;
      // an unstamped queued row was parked by no lane.
      if (job.lane_env !== getRuntimeEnv() || (job.lane_env_id ?? null) !== (process.env.RAILWAY_ENVIRONMENT_ID || null)) {
        return reply.status(409).send(NOT_THIS_ENVIRONMENT)
      }
      const ownerId = job.user_id
      const result = await cancelOwnedJob(jobId, ownerId)
      switch (result.kind) {
        case "not_found":
        case "forbidden":
          return reply.status(404).send({ error: { code: "not_found", message: "Job not found" } })
        case "invalid_status":
          return reply.status(409).send({ error: { code: "not_queued", message: `Only a job waiting for a slot can be cancelled here (status: ${result.status})` } })
        case "in_flight":
          return { cancelled: false, inFlight: true, userId: ownerId }
        case "lost_race":
          return { cancelled: false, inFlight: false, userId: ownerId }
        case "cancelled":
          break
      }
      await cancelRunningChildJobs(jobId, ownerId, { analysisJobId: result.analysisJobId })
      invalidateBalanceCache(ownerId)
      req.log.info({ jobId, ownerId, by: req.userId }, "an admin cancelled a queued job")
      return { cancelled: true, inFlight: false, userId: ownerId }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to cancel the job")
    }
  })

  // The rest are the per-plan table and what goes with it: Cloud only.
  if (!hasCredits()) return

  // ------------------------------------------------------------- plans
  app.put("/v1/admin/lanes/plans/:tier", { preHandler: requirePlatformOperator }, async (req, reply) => {
    const params = tierParams.safeParse(req.params)
    if (!params.success) return reply.status(400).send(invalid(params.error))
    const body = planBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send(invalid(body.error))
    const { error } = await supabase
      .from("lane_plan_sizes")
      .upsert({ tier: params.data.tier, ...body.data, updated_at: new Date().toISOString() }, { onConflict: "tier" })
    if (error) return sendInternalError(reply, req, error, "Failed to save the plan's lane sizes")
    invalidateLaneConfigCache()
    return { tier: params.data.tier, sizes: body.data }
  })

  // --------------------------------------------------------- ceilings
  app.put("/v1/admin/lanes/providers/:provider", { preHandler: requirePlatformOperator }, async (req, reply) => {
    const params = providerParams.safeParse(req.params)
    if (!params.success) return reply.status(400).send(invalid(params.error))
    const body = ceilingBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send(invalid(body.error))
    const { provider } = params.data
    const { ceiling } = body.data
    const { error } = ceiling === null
      ? await supabase.from("lane_provider_ceilings").delete().eq("provider", provider)
      : await supabase.from("lane_provider_ceilings").upsert({ provider, ceiling, updated_at: new Date().toISOString() }, { onConflict: "provider" })
    if (error) return sendInternalError(reply, req, error, "Failed to save the provider ceiling")
    // Drop the cached table first, so the gate gets the ceilings just written.
    invalidateLaneConfigCache()
    let applied = true
    try {
      // A failed read leaves the gate's ceilings as they are (never cleared to
      // `{}`); the mirror copies the table within 30 s.
      const ceilings = await providerCeilingsForGate()
      if (ceilings === null) applied = false
      else await concurrencyGate().setProviderCeilings(ceilings)
    } catch (err) {
      // Saved; the enforcement mirror copies it into the gate within 30 s.
      req.log.warn({ err }, "provider ceiling saved but not yet copied into the gate")
      applied = false
    }
    return { provider, ceiling, applied }
  })

  // --------------------------------------------------------- overrides
  app.put("/v1/admin/lanes/users/:id", { preHandler: requirePlatformOperator }, async (req, reply) => {
    const params = userParams.safeParse(req.params)
    if (!params.success) return reply.status(400).send(invalid(params.error))
    const body = overrideBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send(invalid(body.error))
    const userId = params.data.id
    const lanes = Object.fromEntries(LANES.map((lane) => [lane, body.data[lane] ?? null])) as Record<(typeof LANES)[number], number | null>
    const note = body.data.note?.trim() || null
    if (LANES.every((lane) => lanes[lane] === null)) {
      const { error } = await supabase.from("lane_user_overrides").delete().eq("user_id", userId)
      if (error) return sendInternalError(reply, req, error, "Failed to remove the lane override")
      invalidateLaneConfigCache()
      return { userId, override: null, note: null }
    }
    const { error } = await supabase.from("lane_user_overrides").upsert(
      { user_id: userId, ...lanes, note, updated_at: new Date().toISOString(), updated_by: req.userId ?? null },
      { onConflict: "user_id" },
    )
    if (error?.code === "23503") {
      return reply.status(404).send({ error: { code: "not_found", message: "No such user" } })
    }
    if (error) return sendInternalError(reply, req, error, "Failed to save the lane override")
    invalidateLaneConfigCache()
    const override: Partial<LaneSizes> = {}
    for (const lane of LANES) if (lanes[lane] !== null) override[lane] = lanes[lane] as number
    return { userId, override, note }
  })

  // ---------------------------------------------------------- settings
  app.put("/v1/admin/lanes/settings", { preHandler: requirePlatformOperator }, async (req, reply) => {
    const body = settingsBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send(invalid(body.error))
    const now = new Date().toISOString()
    const { error } = await supabase.from("app_settings").upsert(
      [
        { key: LANE_QUEUE_TIMEOUT_KEY, value: body.data.queueTimeoutMinutes, updated_at: now, updated_by: req.userId ?? null },
        { key: LANE_LIVE_WAIT_KEY, value: body.data.liveWaitMinutes, updated_at: now, updated_by: req.userId ?? null },
      ],
      { onConflict: "key" },
    )
    if (error) return sendInternalError(reply, req, error, "Failed to save the lane settings")
    invalidateLaneConfigCache()
    return { settings: { ...body.data, liveWaitMaxMinutes: LANE_LIVE_WAIT_RANGE.max } }
  })
}

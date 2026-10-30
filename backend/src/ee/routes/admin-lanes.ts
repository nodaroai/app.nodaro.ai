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
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { config, hasCredits } from "../../lib/config.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { getRuntimeEnv } from "../../lib/runtime-env.js"
import { supabase } from "../../lib/supabase.js"
import { LANE_PLAN_TIERS } from "../../lib/concurrency-lanes/defaults.js"
import {
  enforcementPreconditions,
  readLanesEnforcedSetting,
  setLanesEnforced,
  unmetPreconditions,
} from "../../lib/concurrency-lanes/enforcement.js"
import { concurrencyGate } from "../../lib/concurrency-lanes/instance.js"
import { laneSettings, lanesEnforced, providerCeilings, providerCeilingsForGate } from "../../lib/concurrency-lanes/sizes.js"
import type { LaneSizes } from "../../lib/concurrency-lanes/types.js"
import {
  cloudPlanSizes,
  invalidateLaneConfigCache,
  LANE_LIVE_WAIT_KEY,
  LANE_LIVE_WAIT_RANGE,
  LANE_QUEUE_TIMEOUT_KEY,
  LANE_QUEUE_TIMEOUT_RANGE,
  LANE_SIZE_RANGE,
} from "../concurrency-lanes/plan-sizes.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { requirePlatformOperator } from "../middleware/require-platform-operator.js"

const MINUTE_MS = 60_000
const LANES = ["provider", "llm", "local", "run"] as const
/** The most a provider ceiling may be (568 only asks for ≥ 1; this keeps a typo out of INT range). */
const CEILING_MAX = 100_000
const NOTE_MAX = 500

const laneSize = z.number().int().min(LANE_SIZE_RANGE.min).max(LANE_SIZE_RANGE.max)

const planBody = z.object({ provider: laneSize, llm: laneSize, local: laneSize, run: laneSize }).strict()
const tierParams = z.object({ tier: z.enum(LANE_PLAN_TIERS) })

const providerParams = z.object({ provider: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/) })
const ceilingBody = z.object({ ceiling: z.number().int().min(1).max(CEILING_MAX).nullable() }).strict()

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

/** This environment's switch: the setting, or the gate's flag when the database cannot be read. */
async function enforcedNow(): Promise<boolean> {
  try {
    return await readLanesEnforcedSetting()
  } catch {
    return lanesEnforced()
  }
}

export async function adminLanesRoutes(app: FastifyInstance): Promise<void> {
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
        preconditions,
        unmet: unmetPreconditions(preconditions),
        editable,
        env: getRuntimeEnv(),
        sharedAcrossEnvironments: true,
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
      return sendInternalError(reply, req, err, "Failed to change the lane switch")
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

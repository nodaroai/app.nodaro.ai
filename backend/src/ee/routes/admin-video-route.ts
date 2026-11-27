// @registry-lookup reads the charged price of each id the route lists (getChargedPriceTable), never the registry itself
/**
 * Admin → Video route: which route each routable video model (the Seedance
 * 2.x family) takes, per service, and the routed price's correction factors
 * (docs/design/alternate-routes.md, "Routing per model"). Admin-only;
 * registered under `hasAdmin() && hasCredits()` (app.ts).
 *
 *   GET  /v1/admin/video-route           the policy, this environment's route, the models, services, listed prices and factors
 *   PUT  /v1/admin/video-route           { policy }: save the whole policy (audit-logged)
 *   POST /v1/admin/video-route/revert    every model back on the default route (always allowed; audit-logged)
 *   PUT  /v1/admin/video-route/factors   { factors }: edit or reset the correction factors (audit-logged)
 *   POST /v1/admin/video-route/holds/:jobId   { decision, expectedChargedCredits }: confirm a held bill (charge in full), settle an unbilled run at its quote, or reject either (release, a recorded loss); audit-logged
 *
 * Settings belong to this environment. New jobs follow its selected supplier;
 * an unavailable selected supplier refuses admission without a supplier switch.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { getAppSettings } from "../../lib/app-settings.js"
import { ALTERNATE_ROUTE_JOB_TYPES } from "../../lib/alternate-route-request.js"
import { alternateRoutePrices, currentRouteView } from "../../lib/alternate-route-prices.js"
import { HOST_ROUTES_PER_MODEL } from "../../lib/video-route-host.js"
import { getPluginJobTypes, getPluginServices } from "../../lib/private-plugins/services-registry.js"
import {
  ROUTABLE_VIDEO_MODELS,
  videoRoutePolicyKey,
  videoRoutePriceFactorsKey,
  anyModelRouted,
  defaultVideoRoutePolicy,
  parseVideoRoutePolicy,
  parseVideoRoutePriceFactors,
  priceFactorSchema,
  revertedVideoRoutePolicy,
  videoRoutePolicySchema,
  type VideoRoutePolicy,
  type VideoRoutePriceFactor,
} from "../../lib/video-route-policy.js"
import {
  videoRouteSpendDaysKey,
  readSettingsRowValue,
  readVideoRoutePolicy,
  readVideoRoutePriceFactors,
  saveVideoRoutePolicy,
  updateSettingsRow,
} from "../../lib/video-route-policy-store.js"
import { modelOfPriceId, routeUsdToBaseCredits, routedChargedCredits, routedPriceIdOf } from "../billing/video-route-pricing.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { getChargedPriceTable } from "../billing/credits.js"
import { getRuntimeEnv } from "../../lib/runtime-env.js"
import { readVideoRouteAlerts, type VideoRouteAlert } from "../billing/video-route-alerts.js"
import { readBalances, spendDaysOf, type SpendDay } from "../billing/video-route-watch.js"
import { RUNTIME_ENV_NAMEABLE, supabase } from "../../lib/supabase.js"
import { VIDEO_ROUTE_OUTCOME_KEY, type VideoRouteOutcome } from "../billing/video-route-admission.js"
import { audit } from "./admin-trends-lifecycle.js"
import { decideRouteSettleHold, patchRouteSettle, readHeldRouteSettle, readHeldRouteSettles, readRouteLedger, type HeldRouteSettle } from "../../lib/video-route-ledger.js"
import { resolveRouteLedger } from "../../lib/video-route-resolve.js"
import { videoRouteSchemaMissing } from "../../lib/video-route-schema.js"
import { CONFIRM_ROUNDING_CREDITS } from "../billing/video-route-receipt.js"
import { previewRoutedSettlement, recoverRoutedSettlement, RoutedSettleHeld } from "../billing/video-route-settlement.js"

const holdParams = z.strictObject({ jobId: z.string().uuid() })
// `confirm`: charge a held bill in full. `quote`: charge an unbilled run at its quote. `reject`: release either.
// A confirm or a settle-at-quote names the total the admin was shown (`wouldCharge` of the view): the
// decision is for that total only.
const holdBody = z.strictObject({ decision: z.enum(["confirm", "quote", "reject"]), expectedChargedCredits: z.number().int().nonnegative().optional() })
  .refine((b) => b.decision === "reject" || b.expectedChargedCredits !== undefined, { path: ["expectedChargedCredits"], message: "State the total you were shown" })
const HOLD_DECISIONS = { confirm: "confirmed", quote: "quote", reject: "rejected" } as const
const HOLD_AUDIT_ACTIONS = { confirm: "confirm_video_route_hold", quote: "settle_video_route_hold_at_quote", reject: "reject_video_route_hold" } as const

/** Every save of this deployment-wide setting is filed under this fixed id. */
export const VIDEO_ROUTE_AUDIT_TARGET = "00000000-0000-4000-8000-00000000d0e1"

/** A policy as an admin saves it: models restricted to the routable ones. */
const savePolicySchema = videoRoutePolicySchema.superRefine((p, ctx) => {
  for (const model of Object.keys(p.models)) {
    if (!ROUTABLE_VIDEO_MODELS.includes(model)) ctx.addIssue({ code: "custom", path: ["models", model], message: `${model} cannot be routed` })
  }
})

const putPolicyBody = z.strictObject({
  policy: savePolicySchema,
  /** The page's `updatedAt` the edit was made on (null: never saved): a save over a newer policy is refused (409), never allowed to overwrite it. */
  expectedUpdatedAt: z.string().nullable(),
})
/** A factor key, as `priceFactorKey` writes it: model:resolution:ref|noref:kind. */
const FACTOR_KEY = /^seedance-2[a-z0-9-]*:(480p|720p|1080p|4k|default):(ref|noref):(generate|draft-finalize|extend)$/
const putFactorsBody = z.strictObject({
  factors: z.record(z.string().regex(FACTOR_KEY, "not a price factor key"), priceFactorSchema.omit({ updatedAt: true, by: true })),
  /** The table's `factorsUpdatedAt` the edit was made on: a save over a newer table (an automatic raise since) is refused (409). */
  expectedUpdatedAt: z.string().nullable(),
})

export interface VideoRouteAdminView {
  policy: VideoRoutePolicy
  /** null = never saved (every model on the default route). */
  updatedAt: string | null
  /** This environment's route service: whether one is loaded, and whether it routes per model. */
  route: { present: boolean; v2: boolean }
  models: Array<{ id: string; name: string; capable: boolean }>
  /** The services a choice can be made for: the platform lanes, then the plugin's job types. */
  services: { platform: string[]; plugin: string[] }
  /** Whether this build runs routed jobs at all; a model can be put on the alternate route only when it does. */
  routesPerModel: boolean
  /** The route's listed prices, by model: base and as charged (the markup of the same platform id). */
  /** The route's listed prices as charged, beside the default provider's charged price of the same id (null: not priced there). */
  prices: Record<string, Array<{ id: string; base: number; charged: number; defaultCharged: number | null }>>
  factors: Record<string, { factor: number; updatedAt: string; by: "auto" | "admin"; reason?: string }>
  factorsUpdatedAt: string | null
  /**
   * The last {@link OUTCOME_DAYS} days of jobs whose model was routed for
   * their service: per model and service, how many the route took and, for
   * the rest, why they were refused or historically used the default route.
   */
  outcomes: Array<{ model: string; service: string; alternate: number; kept: Record<string, number>; refused: Record<string, number> }>
  /** The route's account right now (null: no route here, or it cannot be read) and the default provider's latest snapshotted balance. */
  balances: { route: { availableUsd: number; heldUsd: number; observedAt: string } | null; defaultProviderCredits: number | null }
  /** This environment's daily reconciliations, newest first: recorded cost of routed jobs against the route's own spend. */
  alerts: VideoRouteAlert[]
  spendDays: SpendDay[]
  /**
   * Settlements waiting for an admin, oldest first: a bill far above its quote (confirm or reject), or a run the route
   * never billed (settle at its quote or release). Each carries what a decision would do RIGHT NOW: `wouldCharge` is the
   * real bill of every billed send plus the quote of every unbilled one (null: not computable yet), `totalAnomalous`
   * says that total is itself far above the quote (settling it at the quote would hold it, not charge it), and a
   * release records `wouldCharge` as the loss.
   */
  holds: Array<HeldRouteSettle & { wouldCharge: number | null; totalAnomalous: boolean }>
  /**
   * What the loaded route takes today with no policy saved, as it reports it
   * (routable models and known services only). null: the route does not say,
   * so the page cannot pre-fill a first save.
   */
  legacyRouting: Array<{ model: string; service: string }> | null
  /** Entries the route reported that this host does not recognise (not a routable model, or a service it does not have): they cannot be kept, and move to the default route at the first save. */
  legacyRoutingUnrecognised: Array<{ model: string; service: string }>
  /** Whether this server can name its environment to the database: unpaid-charge enforcement can be turned on only then. */
  environmentNameable: boolean
}

/** How far back the routing outcomes are counted. */
export const OUTCOME_DAYS = 7
const OUTCOME_ROWS = 5000

async function readOutcomes(): Promise<VideoRouteAdminView["outcomes"]> {
  const since = new Date(Date.now() - OUTCOME_DAYS * 86_400_000).toISOString()
  // trash-read: a count of what admission decided, whatever became of the job.
  const { data, error } = await supabase
    .from("jobs")
    .select(`outcome:input_data->${VIDEO_ROUTE_OUTCOME_KEY}`)
    .gte("created_at", since)
    .eq(`input_data->${VIDEO_ROUTE_OUTCOME_KEY}->>env`, getRuntimeEnv())
    .order("created_at", { ascending: false })
    .limit(OUTCOME_ROWS)
  if (error) throw new Error(`Could not read the routing outcomes: ${error.message}`)
  const byKey = new Map<string, VideoRouteAdminView["outcomes"][number]>()
  for (const row of (data ?? []) as Array<{ outcome?: unknown }>) {
    const o = row.outcome as Partial<VideoRouteOutcome> | null | undefined
    if (!o || typeof o.model !== "string" || typeof o.service !== "string") continue
    if (o.route !== "alternate" && o.route !== "default" && o.route !== "refused") continue
    const key = `${o.model}\u0000${o.service}`
    const entry = byKey.get(key) ?? { model: o.model, service: o.service, alternate: 0, kept: {}, refused: {} }
    if (o.route === "alternate") entry.alternate++
    else if (o.route === "refused") entry.refused[o.why ?? "unknown"] = (entry.refused[o.why ?? "unknown"] ?? 0) + 1
    else entry.kept[o.why ?? "unknown"] = (entry.kept[o.why ?? "unknown"] ?? 0) + 1
    byKey.set(key, entry)
  }
  return [...byKey.values()].sort((a, b) => a.model.localeCompare(b.model) || a.service.localeCompare(b.service))
}

/**
 * The loaded route's own account of what it takes with no policy saved: the
 * entries this host recognises (a routable model and a service it has), and
 * the ones it does not (shown as such: they cannot be chosen here, so they
 * move to the default route at the first save). `recognised` is null when the
 * route gives no account at all. Never throws.
 */
function legacyRoutingOf(services: ReadonlySet<string>): { recognised: VideoRouteAdminView["legacyRouting"]; unrecognised: Array<{ model: string; service: string }> } {
  try {
    const listed = getPluginServices().alternateRoutes?.legacyRouting?.()
    if (!Array.isArray(listed)) return { recognised: null, unrecognised: [] }
    const seen = new Set<string>()
    const recognised: Array<{ model: string; service: string }> = []
    const unrecognised: Array<{ model: string; service: string }> = []
    for (const entry of listed) {
      const model = String((entry as { model?: unknown } | null)?.model ?? "?").slice(0, 80)
      const service = String((entry as { service?: unknown } | null)?.service ?? "?").slice(0, 80)
      if (seen.has(`${model}\u0000${service}`)) continue
      seen.add(`${model}\u0000${service}`)
      const ok = typeof (entry as { model?: unknown } | null)?.model === "string" && typeof (entry as { service?: unknown } | null)?.service === "string" && ROUTABLE_VIDEO_MODELS.includes(model) && services.has(service)
      ;(ok ? recognised : unrecognised).push({ model, service })
    }
    return { recognised, unrecognised }
  } catch {
    return { recognised: null, unrecognised: [] }
  }
}

async function view(): Promise<VideoRouteAdminView> {
  const [{ policy, updatedAt }, { factors, updatedAt: factorsUpdatedAt }, settings, outcomes, balances, spendRaw, alerts, holds] = await Promise.all([
    readVideoRoutePolicy(),
    readVideoRoutePriceFactors(),
    getAppSettings(),
    readOutcomes(),
    readBalances(),
    readSettingsRowValue(videoRouteSpendDaysKey()),
    readVideoRouteAlerts(),
    readHeldRouteSettles(),
  ])
  const routeView = currentRouteView(modelOfPriceId)
  const legacy = legacyRoutingOf(new Set<string>([...ALTERNATE_ROUTE_JOB_TYPES, ...getPluginJobTypes()]))
  const listed = alternateRoutePrices() ?? {}
  const table = await getChargedPriceTable()
  const defaults = table.unrouted ?? table
  const prices: VideoRouteAdminView["prices"] = {}
  for (const [id, usd] of Object.entries(listed).sort(([a], [b]) => a.localeCompare(b))) {
    const parsed = routedPriceIdOf(id)
    if (!parsed) continue
    const base = routeUsdToBaseCredits(usd)
    const defaultBase = defaults.base(id)
    ;(prices[parsed.model] ??= []).push({ id, base, charged: routedChargedCredits(base, id, settings), defaultCharged: defaultBase === undefined ? null : defaults.charge(id, defaultBase) })
  }
  return {
    policy: policy ?? defaultVideoRoutePolicy(),
    updatedAt,
    route: { present: routeView !== null, v2: routeView?.v2 === true },
    models: ROUTABLE_VIDEO_MODELS.map((id) => ({
      id,
      name: MODEL_CATALOG[id]?.label ?? id,
      capable: routeView?.v2 === true && routeView.capable(id),
    })),
    services: { platform: [...ALTERNATE_ROUTE_JOB_TYPES], plugin: [...getPluginJobTypes()] },
    routesPerModel: HOST_ROUTES_PER_MODEL,
    prices,
    factors,
    factorsUpdatedAt,
    outcomes,
    balances,
    alerts,
    spendDays: spendDaysOf(spendRaw),
    holds: await Promise.all(holds.map(async (hold) => {
      // What each action would do now, from the same computation the settlement uses. Never fails the page.
      const preview = await previewRoutedSettlement(hold.jobId).catch(() => null)
      return { ...hold, wouldCharge: preview?.credits ?? null, totalAnomalous: preview?.anomalous === true }
    })),
    legacyRouting: legacy.recognised,
    legacyRoutingUnrecognised: legacy.unrecognised,
    environmentNameable: RUNTIME_ENV_NAMEABLE,
  }
}

export async function adminVideoRouteRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/video-route", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the video route setting")
    }
  })

  app.put("/v1/admin/video-route", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = putPolicyBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    // A build that cannot run a routed job never saves one: the setting would list a price nothing charges.
    if (!HOST_ROUTES_PER_MODEL && anyModelRouted(parsed.data.policy)) {
      return reply.status(409).send({ error: { code: "routing_unavailable", message: "This build cannot run a model on the alternate route yet." } })
    }
    // A model is put on the alternate route only where the route loaded here can take it: one
    // that speaks per-model routing and knows the model. Otherwise every job of that model
    // would be refused at admission from the moment of the save.
    const routeView = currentRouteView(modelOfPriceId)
    const cannotTake = Object.entries(parsed.data.policy.models)
      .filter(([, m]) => m.route === "alternate" || Object.values(m.services ?? {}).includes("alternate"))
      .map(([model]) => model)
      .filter((model) => !(routeView?.v2 === true && routeView.capable(model)))
    if (cannotTake.length > 0) {
      return reply.status(409).send({ error: { code: "route_cannot_take_model", message: `The alternate route loaded in this environment cannot take ${cannotTake.join(", ")}. Leave ${cannotTake.length > 1 ? "them" : "it"} on the default provider.` } })
    }
    // A per-service choice names a service this deployment has: a platform lane or a plugin job type.
    const known = new Set<string>([...ALTERNATE_ROUTE_JOB_TYPES, ...getPluginJobTypes()])
    const unknownServices = Object.values(parsed.data.policy.models).flatMap((m) => Object.keys(m.services ?? {})).filter((svc) => !known.has(svc))
    if (unknownServices.length > 0) {
      return reply.status(400).send({ error: { code: "validation_error", message: `Unknown service: ${[...new Set(unknownServices)].join(", ")}` } })
    }
    try {
      // Enforcement is scoped to the environment the server names to the database: one it cannot name can never enforce.
      if (parsed.data.policy.enforceUnpaidCharges && !RUNTIME_ENV_NAMEABLE) {
        return reply.status(409).send({ error: { code: "environment_not_nameable", message: "Unpaid charges cannot be enforced here: this server's environment name cannot be sent to the database (it must be 1-64 printable ASCII characters with no space)." } })
      }
      // No model is routed over a schema that is not whole: a missing trigger fails silently.
      if (anyModelRouted(parsed.data.policy)) {
        const missing = await videoRouteSchemaMissing()
        if (missing.length > 0) {
          return reply.status(409).send({ error: { code: "schema_incomplete", message: `No model can be routed here yet: this database's routed-video schema is incomplete (missing: ${missing.join("; ")}).` } })
        }
      }
      // A compare-and-set on the row's `updated_at`: a page edited over an older policy (another
      // admin saved since) is refused, never allowed to overwrite that save.
      let before: VideoRoutePolicy | null = null
      let stale = false
      await updateSettingsRow(videoRoutePolicyKey(), (raw, rowUpdatedAt) => {
        before = raw === null ? null : parseVideoRoutePolicy(raw)
        if (rowUpdatedAt !== parsed.data.expectedUpdatedAt) {
          stale = true
          return undefined
        }
        return parsed.data.policy
      })
      if (stale) return reply.status(409).send({ error: { code: "stale_policy", message: "The video route setting changed since this page loaded. Reload and try again." } })
      await audit(req, "update_video_route_policy", "app_setting", VIDEO_ROUTE_AUDIT_TARGET, { key: videoRoutePolicyKey(), before, after: parsed.data.policy })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the video route setting")
    }
  })

  app.post("/v1/admin/video-route/revert", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const before = (await readVideoRoutePolicy()).policy
      const after = revertedVideoRoutePolicy(before)
      await saveVideoRoutePolicy(after, req.userId!)
      await audit(req, "revert_video_route_policy", "app_setting", VIDEO_ROUTE_AUDIT_TARGET, { key: videoRoutePolicyKey(), before, after })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to revert the video route setting")
    }
  })

  app.post("/v1/admin/video-route/holds/:jobId", { preHandler: requireAdmin }, async (req, reply) => {
    const params = holdParams.safeParse(req.params)
    const body = holdBody.safeParse(req.body)
    if (!params.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(params.error) } })
    if (!body.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(body.error) } })
    const { jobId } = params.data
    const decision = HOLD_DECISIONS[body.data.decision]
    try {
      // By its own job id: a hold past the listed page can be decided too.
      const held = await readHeldRouteSettle(jobId)
      // Compare-and-set: one decision per hold, whoever clicks first.
      // Each kind takes its own decision: a held bill is confirmed, an unbilled run is settled at its quote; either is released.
      if (held && body.data.decision !== "reject" && (held.kind === "unbilled") !== (body.data.decision === "quote")) {
        return reply.status(409).send({ error: { code: "wrong_decision", message: held.kind === "unbilled" ? "This run has no bill to confirm. Settle it at its quote, or release it." : "This run has a bill. Confirm it, or reject it." } })
      }
      // A confirm or a settle-at-quote is for the total the admin SAW. The route is read once more
      // (nothing reads it while a settlement is held), the total is computed again by the
      // settlement's own computation, and a total that is no longer the one shown is not decided
      // by this click: it stays held, with its new figures, for the admin to look at again.
      const expected = body.data.expectedChargedCredits
      if (held && expected !== undefined && body.data.decision !== "reject") {
        const seen = await previewRoutedSettlement(jobId)
        if (seen.routeId) await resolveRouteLedger(jobId, seen.routeId)
        const now = await previewRoutedSettlement(jobId)
        if (now.credits === null || Math.abs(now.credits - expected) > CONFIRM_ROUNDING_CREDITS) {
          if (now.credits !== null) await patchRouteSettle(jobId, {}, { credits: now.credits, billed_usd: now.billedUsd, quoted_usd: now.quotedUsd })
          return reply.status(409).send({
            error: { code: "total_changed", message: now.credits === null ? "The total of this run cannot be computed right now. Nothing was decided; try again." : `The total of this run is now ${now.credits} credits, not the ${expected} you were shown. Nothing was decided; look at it again.` },
            data: { ...(await view()), changed: { jobId, expectedChargedCredits: expected, wouldCharge: now.credits, totalAnomalous: now.anomalous } },
          })
        }
      }
      // Pinned to the kind checked above: a row that changed kind since is not decided by this click.
      if (!held || !(await decideRouteSettleHold(jobId, decision, req.userId!, held.kind, body.data.decision === "reject" ? undefined : expected))) {
        return reply.status(409).send({ error: { code: "not_held", message: "This settlement is not waiting for a decision." } })
      }
      await audit(req, HOLD_AUDIT_ACTIONS[body.data.decision], "job", jobId, { env: getRuntimeEnv(), held })
      // The decision is durable; the one settlement applies it. A failure here is retried by the sweep.
      let settled = false
      // A run settled "at its quote" whose total is far above the quote is not charged: it becomes a held bill, to be confirmed on its own.
      let heldForTotal = false
      try {
        settled = await recoverRoutedSettlement(jobId)
      } catch (e) {
        if (e instanceof RoutedSettleHeld) heldForTotal = true
        else req.log.error({ err: e, jobId }, "applying a decided video route hold failed; the settlement sweep retries it")
      }
      // What the settlement actually did, as computed at that moment (not the figure shown while it was held).
      let chargedCredits: number | null = null
      if (settled) {
        try {
          const settle = (await readRouteLedger(jobId)).settle
          chargedCredits = settle && (settle.state === "done" || settle.state === "shortfall" || settle.state === "waived") ? settle.credits : null
        } catch {
          chargedCredits = null
        }
      }
      return { data: { ...(await view()), decided: { jobId, decision, settled, chargedCredits, heldForTotal } } }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to decide the held settlement")
    }
  })

  app.put("/v1/admin/video-route/factors", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = putFactorsBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const now = new Date().toISOString()
      let before: Record<string, VideoRoutePriceFactor> = {}
      let stale = false
      let after: Record<string, VideoRoutePriceFactor> = {}
      // A compare-and-set on the table's `updated_at` (updateSettingsRow): a page
      // edited over an older table — an automatic raise landed since — is refused,
      // never allowed to drop that raise.
      await updateSettingsRow(videoRoutePriceFactorsKey(), (raw, rowUpdatedAt) => {
        before = parseVideoRoutePriceFactors(raw)
        if (rowUpdatedAt !== parsed.data.expectedUpdatedAt) {
          stale = true
          return undefined
        }
        // A factor of exactly 1 is the same as none: dropped, so "reset" is setting it to 1.
        after = Object.fromEntries(
          Object.entries(parsed.data.factors)
            .filter(([, f]) => f.factor > 1)
            .map(([key, f]) => [key, { factor: f.factor, updatedAt: before[key]?.factor === f.factor ? before[key]!.updatedAt : now, by: before[key]?.factor === f.factor ? before[key]!.by : ("admin" as const), ...(f.reason ? { reason: f.reason } : {}) }]),
        )
        return after
      })
      if (stale) return reply.status(409).send({ error: { code: "stale_factors", message: "The price factors changed since this page loaded. Reload and try again." } })
      await audit(req, "update_video_route_price_factors", "app_setting", VIDEO_ROUTE_AUDIT_TARGET, { key: videoRoutePriceFactorsKey(), before, after })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the video route price factors")
    }
  })
}

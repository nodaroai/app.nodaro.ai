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
 *
 * The settings row is shared by every environment on this database: a save
 * applies to new jobs everywhere within the settings cache's next read. An
 * environment whose route cannot take a model keeps running it on the default
 * route at the default price (`decideVideoRoute`).
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
import { getPluginJobTypes } from "../../lib/private-plugins/services-registry.js"
import {
  ROUTABLE_VIDEO_MODELS,
  videoRoutePolicyKey,
  videoRoutePriceFactorsKey,
  anyModelRouted,
  defaultVideoRoutePolicy,
  parseVideoRoutePriceFactors,
  priceFactorSchema,
  revertedVideoRoutePolicy,
  videoRoutePolicySchema,
  type VideoRoutePolicy,
  type VideoRoutePriceFactor,
} from "../../lib/video-route-policy.js"
import {
  readVideoRoutePolicy,
  readVideoRoutePriceFactors,
  saveVideoRoutePolicy,
  updateSettingsRow,
} from "../../lib/video-route-policy-store.js"
import { modelOfPriceId, routeUsdToBaseCredits, routedChargedCredits, routedPriceIdOf } from "../billing/video-route-pricing.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { audit } from "./admin-trends-lifecycle.js"

/** Every save of this deployment-wide setting is filed under this fixed id. */
export const VIDEO_ROUTE_AUDIT_TARGET = "00000000-0000-4000-8000-00000000d0e1"

/** A policy as an admin saves it: models restricted to the routable ones. */
const savePolicySchema = videoRoutePolicySchema.superRefine((p, ctx) => {
  for (const model of Object.keys(p.models)) {
    if (!ROUTABLE_VIDEO_MODELS.includes(model)) ctx.addIssue({ code: "custom", path: ["models", model], message: `${model} cannot be routed` })
  }
})

const putPolicyBody = z.strictObject({ policy: savePolicySchema })
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
  prices: Record<string, Array<{ id: string; base: number; charged: number }>>
  factors: Record<string, { factor: number; updatedAt: string; by: "auto" | "admin"; reason?: string }>
  factorsUpdatedAt: string | null
}

async function view(): Promise<VideoRouteAdminView> {
  const [{ policy, updatedAt }, { factors, updatedAt: factorsUpdatedAt }, settings] = await Promise.all([
    readVideoRoutePolicy(),
    readVideoRoutePriceFactors(),
    getAppSettings(),
  ])
  const routeView = currentRouteView(modelOfPriceId)
  const listed = alternateRoutePrices() ?? {}
  const prices: VideoRouteAdminView["prices"] = {}
  for (const [id, usd] of Object.entries(listed).sort(([a], [b]) => a.localeCompare(b))) {
    const parsed = routedPriceIdOf(id)
    if (!parsed) continue
    const base = routeUsdToBaseCredits(usd)
    ;(prices[parsed.model] ??= []).push({ id, base, charged: routedChargedCredits(base, id, settings) })
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
    // A per-service choice names a service this deployment has: a platform lane or a plugin job type.
    const known = new Set<string>([...ALTERNATE_ROUTE_JOB_TYPES, ...getPluginJobTypes()])
    const unknownServices = Object.values(parsed.data.policy.models).flatMap((m) => Object.keys(m.services ?? {})).filter((svc) => !known.has(svc))
    if (unknownServices.length > 0) {
      return reply.status(400).send({ error: { code: "validation_error", message: `Unknown service: ${[...new Set(unknownServices)].join(", ")}` } })
    }
    try {
      const before = (await readVideoRoutePolicy()).policy
      await saveVideoRoutePolicy(parsed.data.policy, req.userId!)
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

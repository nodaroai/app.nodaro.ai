import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import { requireAdmin } from "../middleware/require-admin.js"
import { siteAnalytics, type SiteAnalyticsService } from "../lib/site-analytics/site-analytics.js"
import type { SiteAnalyticsDays } from "../lib/site-analytics/ga4-report.js"

/**
 * Site Analytics: the platform's Google Analytics traffic and Search Console
 * search data, read with the deployment's service account, for every admin —
 * none of them needs a Google login or access of their own. Read-only; no
 * money moves, so the plain admin gate.
 */

const reportQuery = z.object({
  days: z.enum(["7", "28", "90"]).default("28"),
  fresh: z.literal("1").optional(),
})

const inspectBody = z.object({
  url: z.string().trim().url().max(2048),
  fresh: z.boolean().optional(),
})

/**
 * Per caller (the rate limiter keys on the credential). The real bound on
 * Google's quota is server-side: a minute between forced reloads, and a daily
 * budget of page checks shared by every admin (`inspection-budget.ts`).
 */
const REPORT_LIMIT = { rateLimit: { max: 30, timeWindow: "1 minute" } }
const INSPECT_LIMIT = { rateLimit: { max: 30, timeWindow: "1 minute" } }
/** The page asks once a minute; the snapshot is shared, so this only bounds a runaway client. */
const REALTIME_LIMIT = { rateLimit: { max: 20, timeWindow: "1 minute" } }

function validationError(reply: FastifyReply, error: z.ZodError) {
  const issue = error.issues[0]
  const path = issue?.path.join(".")
  return reply.status(400).send({ error: { code: "validation_error", message: issue ? (path ? `${path}: ${issue.message}` : issue.message) : "invalid request" } })
}

export async function adminSiteAnalyticsRoutes(app: FastifyInstance, opts: { service?: SiteAnalyticsService } = {}): Promise<void> {
  const service = () => opts.service ?? siteAnalytics()

  app.get("/v1/admin/site-analytics", { preHandler: requireAdmin, config: REPORT_LIMIT }, async (req, reply) => {
    const parsed = reportQuery.safeParse(req.query)
    if (!parsed.success) return validationError(reply, parsed.error)
    return service().report(Number(parsed.data.days) as SiteAnalyticsDays, { fresh: parsed.data.fresh === "1" })
  })

  app.get("/v1/admin/site-analytics/realtime", { preHandler: requireAdmin, config: REALTIME_LIMIT }, async () => service().realtime())

  app.post("/v1/admin/site-analytics/inspect", { preHandler: requireAdmin, config: INSPECT_LIMIT }, async (req, reply) => {
    const parsed = inspectBody.safeParse(req.body)
    if (!parsed.success) return validationError(reply, parsed.error)
    const result = await service().inspect(parsed.data.url, { fresh: parsed.data.fresh === true })
    switch (result.status) {
      case "ok":
        return result.data
      case "not_in_site":
        return reply.status(400).send({ error: { code: "not_in_site", message: "That page is not part of the Search Console site." } })
      case "not_configured":
        return reply.status(503).send({ error: { code: "not_configured", message: "Search Console is not set up on this deployment." } })
      case "error":
        if (result.reason === "DAILY_BUDGET") return reply.status(429).send({ error: { code: "daily_budget", message: result.message } })
        return reply.status(502).send({ error: { code: "google_error", message: result.message } })
    }
  })
}

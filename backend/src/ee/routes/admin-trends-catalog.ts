/**
 * Refreshing the trend catalog's kept copies by hand (decided 2026-10-31).
 * Registered by `adminTrendsRoutes` (admin-trends.ts), so it shares its
 * `requireAdmin` door and its edition gate.
 *
 *   POST /v1/admin/trends/catalog/refresh   drop every kept guest answer → { data: { refreshedAt } }
 *
 * Every catalog write already does this (catalog-stamp.ts); the button is for
 * a copy that still looks out of date: a change made outside the store, or a
 * purge the edge refused. 503 `refresh_failed` when the new stamp could not be
 * written: then only this process dropped its copies, and saying "done" would
 * be false. Writes an `admin_actions` row when it worked.
 */
import type { FastifyInstance } from "fastify"
import { requireAdmin } from "../middleware/require-admin.js"
import { trendCatalogChanged } from "../lib/trends/catalog-stamp.js"
import { audit } from "./admin-trends-lifecycle.js"

/** `admin_actions.target_id` is a uuid: the whole catalog is no one row, so the nil uuid. */
const CATALOG_TARGET_ID = "00000000-0000-0000-0000-000000000000"

export function registerTrendCatalogRoutes(app: FastifyInstance): void {
  app.post("/v1/admin/trends/catalog/refresh", { preHandler: requireAdmin }, async (req, reply) => {
    if (!(await trendCatalogChanged())) {
      return reply.status(503).send({
        error: { code: "refresh_failed", message: "The catalog could not be refreshed everywhere. Try again." },
      })
    }
    await audit(req, "refresh_trend_catalog", "trend_catalog", CATALOG_TARGET_ID, {})
    return { data: { refreshedAt: new Date().toISOString() } }
  })
}

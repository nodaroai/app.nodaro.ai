import type { FastifyInstance } from "fastify"
import { effectiveDeniedNodeTypes, effectiveDeniedModelIds } from "../lib/surface-deny.js"

/**
 * The EFFECTIVE node/model availability for this deployment (B5) — the
 * browser mirror of the three-layer funnel lib/surface-deny.ts resolves
 * (edition/code → surface-profile factory → admin runtime override). The
 * static profile in /config.js cannot carry the runtime override, so the
 * picker and model dropdowns fetch this once and layer it over their local
 * profile fallback. The backend stays the authority either way: a stale
 * browser list is cosmetic (write/run still refuse).
 */
export async function surfaceAvailabilityRoutes(app: FastifyInstance) {
  app.get("/v1/surface/availability", async (_req, reply) => {
    return reply.send({
      nodes: { denied: effectiveDeniedNodeTypes() },
      models: { denied: effectiveDeniedModelIds() },
    })
  })
}

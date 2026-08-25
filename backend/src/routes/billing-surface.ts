import type { FastifyInstance } from "fastify"
import { billingSurface, getBillingProvider } from "../lib/billing-provider.js"

/**
 * B2 core billing surface.
 *
 * GET /v1/billing/surface  — deployment-level projection (which provider is
 *   registered, its display unit, its capabilities, whether the Cost tab
 *   mounts). No per-user data → public + cacheable. Lets the cost/usage views
 *   render generically instead of adding to the 126 hasCredits()/36 isCloud()
 *   frontend gates.
 * GET /v1/billing/account  — per-user account summary from the registered
 *   provider (plan, balance, daily allowance, unit). null = the authority
 *   could not answer; the client renders that distinctly, never as a zero.
 */
export async function billingSurfaceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/billing/surface", async (_req, reply) => {
    return reply.send({ data: billingSurface() })
  })

  app.get("/v1/billing/account", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }
    const summary = await getBillingProvider().account(req.userId)
    return reply.send({ data: summary })
  })
}

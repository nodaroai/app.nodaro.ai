import type { FastifyInstance } from "fastify"
import { getUpdateStatus } from "../lib/update-check.js"

/**
 * GET /v1/version — the running version + whether a newer release exists
 * (the sidebar red dot reads this; versioning spec, plan repo 2026-08-19).
 * Public on purpose, like /health: presence data only, nothing tenant-scoped.
 * On cloud (or NODARO_UPDATE_CHECK=off) it degrades to
 * { current, updateAvailable: false } without any outbound request.
 */
export async function versionRoutes(app: FastifyInstance) {
  app.get("/v1/version", async (_req, reply) => {
    const status = await getUpdateStatus()
    return reply.header("Cache-Control", "public, max-age=3600").send(status)
  })
}

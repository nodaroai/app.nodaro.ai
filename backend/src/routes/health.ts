import type { FastifyInstance } from "fastify"
import { getAppVersion } from "../lib/app-version.js"

export async function healthRoutes(app: FastifyInstance) {
  // Read every few seconds (the container's health check, the start script's
  // boot wait, uptime monitors), so a read that succeeds is not logged: the
  // route logs at warn, which drops Fastify's two info lines per request. A
  // read that fails is: a throw is logged at error by Fastify, and any other
  // failure status (a hook answering before the route runs) by the hook below.
  app.get(
    "/health",
    {
      logLevel: "warn",
      onResponse: async (request, reply) => {
        if (reply.statusCode >= 400) {
          request.log.warn({ res: reply, responseTime: reply.elapsedTime }, `health read answered ${reply.statusCode}`)
        }
      },
    },
    async () => {
      return {
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: getAppVersion(),
      }
    },
  )
}

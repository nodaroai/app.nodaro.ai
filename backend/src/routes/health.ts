import type { FastifyInstance } from "fastify"
import { getAppVersion } from "../lib/app-version.js"

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: getAppVersion(),
    }
  })
}

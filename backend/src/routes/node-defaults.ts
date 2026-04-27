import type { FastifyInstance } from "fastify"
import { getNodeDefaults } from "../lib/node-defaults-cache.js"

export async function nodeDefaultsRoutes(app: FastifyInstance) {
  app.get("/v1/node-defaults", async () => {
    const defaults = await getNodeDefaults()
    return { defaults }
  })
}

import type { FastifyInstance } from "fastify"
import { generateOpenApiDoc } from "../lib/openapi-registry.js"
import { isAnonymousRoute } from "../middleware/auth.js"

let cached: ReturnType<typeof generateOpenApiDoc> | null = null

export async function openapiRoutes(app: FastifyInstance) {
  app.get("/v1/openapi.json", async (_req, reply) => {
    if (!cached) cached = generateOpenApiDoc({ isAnonymous: isAnonymousRoute })
    return reply.header("Cache-Control", "public, max-age=300").send(cached)
  })
}

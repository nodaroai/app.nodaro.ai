import type { FastifyInstance } from "fastify"
import { generateOpenApiDoc } from "../lib/openapi-registry.js"

let cached: ReturnType<typeof generateOpenApiDoc> | null = null

export async function openapiRoutes(app: FastifyInstance) {
  app.get("/v1/openapi.json", async (_req, reply) => {
    if (!cached) cached = generateOpenApiDoc()
    return reply.header("Cache-Control", "public, max-age=300").send(cached)
  })
}

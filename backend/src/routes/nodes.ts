import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { getEnrichedRegistry, findNode } from "../lib/node-registry.js"

const typeParams = z.object({ type: z.string().min(1) })

export async function nodesRoutes(app: FastifyInstance) {
  app.get("/v1/nodes", async (_req, reply) => {
    const data = getEnrichedRegistry()
    return reply
      .header("Cache-Control", "public, max-age=300")
      .send({ data })
  })

  app.get("/v1/nodes/:type", async (req, reply) => {
    const parsed = typeParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid type" } })
    }
    const node = findNode(parsed.data.type)
    if (!node) {
      return reply.status(404).send({ error: { code: "not_found", message: `Node type not found: ${parsed.data.type}` } })
    }
    return reply
      .header("Cache-Control", "public, max-age=300")
      .send({ data: node })
  })
}

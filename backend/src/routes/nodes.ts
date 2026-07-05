import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { getEnrichedRegistry, findNode } from "../lib/node-registry.js"


import { openApiRegistry } from "../lib/openapi-registry.js"

const NodeDescriptorSchema = z.object({
  type: z.string(),
  label: z.string(),
  category: z.string(),
  description: z.string(),
  outputType: z.string(),
  creditCost: z.union([z.number(), z.string()]).optional(),
  inputSchema: z.object({ fields: z.array(z.object({
    key: z.string(), type: z.string(), required: z.boolean().optional(), options: z.array(z.string()).optional(),
  })) }).optional(),
  providers: z.array(z.string()).optional(),
}).openapi("NodeDescriptor")

openApiRegistry.registerPath({
  method: "get", path: "/v1/nodes",
  description: "List every runnable node type with its descriptor (label, category, credit cost, providers).",
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: "Node descriptors", content: { "application/json": { schema: z.object({ data: z.array(NodeDescriptorSchema) }) } } } },
})
openApiRegistry.registerPath({
  method: "get", path: "/v1/nodes/{type}",
  description: "Descriptor for one node type — including its provider list for model pickers.",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ type: z.string() }) },
  responses: {
    200: { description: "Node descriptor", content: { "application/json": { schema: z.object({ data: NodeDescriptorSchema }) } } },
    404: { description: "Unknown node type" },
  },
})

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

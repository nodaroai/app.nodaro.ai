import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { getEstimate, batchEstimate } from "../services/execution-stats.js"

const estimateQuerySchema = z.object({
  model: z.string().min(1),
  aspectRatio: z.string().optional().default(""),
  quality: z.string().optional().default(""),
  duration: z.coerce.number().int().min(0).optional().default(0),
})

const batchBodySchema = z.object({
  nodes: z
    .array(
      z.object({
        nodeId: z.string().min(1),
        model: z.string().min(1),
        aspectRatio: z.string().optional(),
        quality: z.string().optional(),
        duration: z.number().int().min(0).optional(),
      }),
    )
    .min(1)
    .max(50),
})

export async function executionStatsRoutes(app: FastifyInstance) {
  app.get("/v1/execution-stats/estimate", async (req, reply) => {
    // safeParse (not throwing .parse): a raw ZodError would hit Fastify's default
    // handler as a 500 whose body leaks the full validation-issue schema.
    const parsed = estimateQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten().fieldErrors })
    }
    const query = parsed.data
    const result = await getEstimate(query.model, query.aspectRatio, query.quality, query.duration)
    return reply.send(result)
  })

  app.post("/v1/execution-stats/batch-estimate", async (req, reply) => {
    const parsed = batchBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten().fieldErrors })
    }
    const results = await batchEstimate(parsed.data.nodes)
    return reply.send({ estimates: results })
  })
}

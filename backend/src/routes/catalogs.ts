import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { projectAllCatalogs } from "@nodaro/prompts"

const query = z.object({ detail: z.enum(["compact", "full"]).optional() })

/**
 * Server-driven catalog projection (2026-06-05 catalogs contract): a thin,
 * tag-free projection of @nodaro/prompts' REGISTERED (pack-composed) catalog
 * set, so thin clients rendering their own pickers honor a deployment's
 * vendored packs. Read-only, public, cacheable.
 */
export async function catalogsRoutes(app: FastifyInstance) {
  app.get("/v1/catalogs", async (req, reply) => {
    const q = query.safeParse(req.query)
    if (!q.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid query" } })
    }
    return reply
      .header("Cache-Control", "public, max-age=300")
      .send({ data: projectAllCatalogs(q.data) })
  })
}

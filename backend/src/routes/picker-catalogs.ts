import type { FastifyInstance } from "fastify"
import { z } from "zod"
import {
  getPickerCatalog,
  summarizePickerCatalogs,
  projectPickerCatalog,
} from "@nodaro/shared"

const nodeTypeParams = z.object({ nodeType: z.string().min(1).max(64) })
const projectionQuery = z.object({
  detail: z.enum(["compact", "full"]).optional(),
  category: z.string().max(64).optional(),
  field: z.string().max(64).optional(),
})

export async function pickerCatalogsRoutes(app: FastifyInstance) {
  // Directory of every parameter-picker catalog (no option payloads).
  app.get("/v1/picker-catalogs", async (_req, reply) =>
    reply.header("Cache-Control", "public, max-age=300").send({ data: summarizePickerCatalogs() }),
  )

  // One picker's catalog of valid values; compact by default.
  app.get("/v1/picker-catalogs/:nodeType", async (req, reply) => {
    const params = nodeTypeParams.safeParse(req.params)
    if (!params.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid nodeType" } })
    }
    const query = projectionQuery.safeParse(req.query)
    if (!query.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid query" } })
    }
    const catalog = getPickerCatalog(params.data.nodeType)
    if (!catalog) {
      return reply
        .status(404)
        .send({ error: { code: "not_found", message: `Picker catalog not found: ${params.data.nodeType}` } })
    }
    return reply
      .header("Cache-Control", "public, max-age=300")
      .send({ data: projectPickerCatalog(catalog, query.data) })
  })
}

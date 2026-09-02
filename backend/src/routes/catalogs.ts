import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { projectAllCatalogs, getRegisteredCatalogPacks, catalogPacksVersion } from "@nodaro/prompts"

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
    // `curated` tells a browser whether these differ from its bundled copy at
    // all. With no packs the projection is BY DEFINITION the bundle's own
    // catalogs, so the ~700 KB body is omitted: every mainline page load
    // hits this route, and serializing the whole catalog set to say "nothing
    // to see" would be the one measurable cost of the feature on deployments
    // that never use it. `version` lets a client discard a stale registration.
    const packs = getRegisteredCatalogPacks().length
    const version = catalogPacksVersion()
    reply.header("Cache-Control", "public, max-age=300")
    if (packs === 0) return reply.send({ curated: false, packs: 0, version })
    return reply.send({ data: projectAllCatalogs(q.data), curated: true, packs, version })
  })
}

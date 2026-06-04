import type { FastifyInstance } from "fastify"
import { listAvatars, listVoices } from "../providers/heygen/catalog.js"

/**
 * Public catalog routes for HeyGen avatars and voices.
 *
 * Both endpoints are added to PUBLIC_ROUTES in middleware/auth.ts because:
 * - They serve read-only catalog data (no user-specific content).
 * - Published apps render avatar/voice pickers for ANONYMOUS viewers; an
 *   authenticated-only route would 401 those picker requests.
 *
 * When HEYGEN_API_KEY is unset, the underlying catalog functions return []
 * gracefully (200 with empty arrays, no error).
 */
export async function heygenCatalogRoutes(app: FastifyInstance) {
  app.get("/v1/heygen/avatars", async (_req, reply) => {
    const avatars = await listAvatars()
    reply.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
    return reply.send({ avatars })
  })

  app.get("/v1/heygen/voices", async (_req, reply) => {
    const voices = await listVoices()
    reply.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
    return reply.send({ voices })
  })
}

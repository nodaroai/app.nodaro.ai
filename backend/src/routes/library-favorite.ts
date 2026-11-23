import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { setFileFavorite } from "../lib/asset-favorites.js"

const assetIdParams = z.object({ id: z.string().uuid() })

const favoriteBody = z
  .object({
    favorited: z
      .boolean()
      .optional()
      .describe("`true` stars the file, `false` unstars it; omitted toggles it (like `POST /v1/gallery/favorite`)."),
  })
  .strict()

const FavoriteResult = z.object({
  favorited: z.boolean().describe("Whether the file is a favorite now."),
  jobId: z
    .string()
    .uuid()
    .nullable()
    .describe("The job that made the file, whose favorite it shares; null for an upload, which has its own."),
})

openApiRegistry.registerPath({
  method: "post",
  path: "/v1/library/{id}/favorite",
  description:
    "Star or unstar a file in your library by its asset id: one of your own, or a shared library item. A file a job made " +
    "shares that job's favorite (`Job.favorited`, `POST /v1/gallery/favorite`); an upload, which no job made, has its own, and " +
    "so does a file whose job is in the Trash. Send `favorited` to set it — idempotent, so two calls for the same state at " +
    "once both end in it — or no body to toggle. Lists back through `GET /v1/library?favorited=true` and " +
    "`GET /v1/favorites`. OAuth apps need `assets:write`.",
  security: [{ bearerAuth: [] }],
  request: {
    params: assetIdParams,
    body: { content: { "application/json": { schema: favoriteBody } }, required: false },
  },
  responses: {
    200: { description: "The file's favorite now", content: { "application/json": { schema: FavoriteResult } } },
    400: { description: "A body other than `{ favorited?: boolean }`" },
    401: { description: "Unauthorized" },
    403: { description: "An OAuth token without assets:write" },
    404: { description: "No file of yours (or shared) by that id" },
    429: { description: "Too many writes; wait a minute" },
    503: { description: "Starring an upload is not available on this server yet" },
  },
})

/** Writes are rate limited like the voice and preset favorites. */
const WRITE_LIMIT = { rateLimit: { max: 60, timeWindow: "1 minute" } }

/**
 * POST /v1/library/:id/favorite — one favorites list for uploads and
 * generations (lib/asset-favorites.ts). Owner-only: the file is the caller's,
 * or a shared library item; anyone else's is a 404.
 */
export async function libraryFavoriteRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>(
    "/v1/library/:id/favorite",
    { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT },
    async (req, reply) => {
      if (!req.userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }
      const params = assetIdParams.safeParse(req.params)
      if (!params.success) {
        return reply.status(404).send({ error: { code: "not_found", message: "Asset not found" } })
      }
      const body = favoriteBody.safeParse(req.body ?? {})
      if (!body.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(body.error) } })
      }

      let outcome
      try {
        const isAdmin = req.userRole === "admin" || req.userRole === "super_admin"
        outcome = await setFileFavorite(req.userId, params.data.id, body.data.favorited, { isAdmin })
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to favorite file")
      }
      if (outcome.kind === "not_found") {
        return reply.status(404).send({ error: { code: "not_found", message: "Asset not found" } })
      }
      if (outcome.kind === "not_available") {
        return reply.status(503).send({
          error: { code: "not_available", message: "Favorites on uploads are not available on this server yet." },
        })
      }
      return { favorited: outcome.favorited, jobId: outcome.jobId }
    },
  )
}

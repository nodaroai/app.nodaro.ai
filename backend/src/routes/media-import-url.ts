import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { formatZodError } from "../lib/zod-error.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { importImageFromUrl } from "../lib/media-import.js"

/**
 * POST /v1/media/import-url — import a remote IMAGE into the caller's storage.
 *
 * Client apps can't read a cross-origin image's pixels (canvas taint), so a
 * linked image can be displayed but never edited client-side. This route
 * lands it on our R2 (which serves CORS), after which it behaves exactly like
 * an upload: crop it, analyze it, delete it via /v1/media/delete.
 *
 * Body:      { url: string }   (http(s); safeUrlSchema + safeFetch SSRF gates)
 * Response:  { data: { url, thumbnailUrl, assetId, mimeType, sizeBytes,
 *              filename } } — the /v1/upload response shape.
 * Errors:    400 validation_error (not an image / bad url),
 *            413 file_too_large | storage_limit_exceeded,
 *            422 fetch_failed (unreachable / non-2xx origin).
 *
 * All fetch/validation/storage semantics live in lib/media-import.ts; this
 * route only authenticates, validates, and formats.
 */

export const mediaImportUrlBody = z.object({
  url: safeUrlSchema,
})

export async function mediaImportUrlRoutes(app: FastifyInstance) {
  app.post("/v1/media/import-url", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = mediaImportUrlBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const result = await importImageFromUrl(userId, parsed.data.url)
    if (!result.ok) {
      return reply.status(result.status).send({
        error: { code: result.code, message: result.message, ...(result.details ?? {}) },
      })
    }

    const { ok: _ok, ...data } = result
    return { data }
  })
}

import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { formatZodError } from "../lib/zod-error.js"
import { deleteOwnedMediaByUrls } from "../lib/media-delete.js"

/**
 * POST /v1/media/delete — best-effort bulk deletion of R2 objects by public
 * URL, with strict per-url ownership. Built for client apps (voice.nodaro.ai)
 * whose "delete this export/conversion" must actually delete the bytes.
 *
 * Body:      { urls: string[] }            (1..50, each a URL)
 * Response:  { deleted: string[], skipped: { url, reason }[] } — 200 even when
 *            everything skipped: deletion is idempotent housekeeping, and a
 *            url that is foreign / already gone / not provably the caller's is
 *            a skip, not a failure.
 *
 * All ownership rules, referrer safety, and storage accounting live in
 * lib/media-delete.ts (routes must not import the service-role client —
 * backend/scripts/check-admin-client-import.mjs); this route only
 * authenticates, validates, and formats.
 */

export const mediaDeleteBody = z.object({
  urls: z.array(z.string().url().max(2048)).min(1).max(50),
})

export async function mediaDeleteRoutes(app: FastifyInstance) {
  app.post("/v1/media/delete", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = mediaDeleteBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    return deleteOwnedMediaByUrls(userId, parsed.data.urls)
  })
}

import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { formatZodError } from "../lib/zod-error.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { importImageFromUrl } from "../lib/media-import.js"
import { isImportRefusal, requireImportAllowed, spendImportConfirmation } from "../lib/import-gate.js"
import { importViaOf } from "../lib/import-via.js"
import { recordEvent } from "../lib/content-rights.js"
import { requireAppWriteScope } from "../lib/scope-prehandler.js"

/**
 * POST /v1/media/import-url — import a remote IMAGE into the caller's storage.
 *
 * Client apps can't read a cross-origin image's pixels (canvas taint), so a
 * linked image can be displayed but never edited client-side. This route
 * lands it on our R2 (which serves CORS), after which it behaves exactly like
 * an upload: crop it, analyze it, delete it via /v1/media/delete.
 *
 * An import of a link, so an ENGINE of the import gate (`lib/import-gate.ts`):
 * the site's policy and the content rights confirmation are checked before
 * anything is fetched (403 with the gate's code), the confirmation spent
 * right before the fetch (the lib's `beforeFetch`), and the import's end
 * noted on it. A fetch that fails afterwards has spent the confirmation: the
 * one-use lock is atomic, so every spend has an attempt behind it.
 *
 * Body:      { url: string, confirmationId?: string }   (http(s); safeUrlSchema + safeFetch SSRF gates)
 * Response:  { data: { url, thumbnailUrl, assetId, mimeType, sizeBytes,
 *              filename, width, height } } — width/height are the decoded
 *              pixel size (0 when it could not be read).
 * Errors:    400 validation_error (not an image / bad url),
 *            403 import_source_disabled | rights_confirmation_* (the gate),
 *            413 file_too_large | storage_limit_exceeded,
 *            422 fetch_failed (unreachable / non-2xx origin).
 *
 * All fetch/validation/storage semantics live in lib/media-import.ts; this
 * route only authenticates, validates, gates, and formats.
 */

export const mediaImportUrlBody = z.object({
  url: safeUrlSchema,
  // The content rights confirmation this import is made under
  // (`POST /v1/content-rights/confirm`). Optional until `content_rights_required` is on.
  confirmationId: z.string().uuid().optional(),
})

export async function mediaImportUrlRoutes(app: FastifyInstance) {
  // An import lands a file in the account: a connected app needs a scope that lets it write.
  app.post("/v1/media/import-url", { preHandler: requireAppWriteScope() }, async (req, reply) => {
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

    const { url, confirmationId } = parsed.data
    const rights = { userId, confirmationId, lane: "route" as const, requestId: req.id, via: importViaOf(req), appId: req.appAuthorization?.appId ?? null, authorizationId: req.appAuthorization?.authorizationId ?? null }
    // The confirmation the fetch ran under: the one sent, or one derived from a key's standing authorization.
    let spent: string | null = null
    let result: Awaited<ReturnType<typeof importImageFromUrl>>
    try {
      await requireImportAllowed(url, rights)
      result = await importImageFromUrl(userId, url, {
        beforeFetch: async () => {
          spent = await spendImportConfirmation(url, rights)
        },
      })
    } catch (e) {
      if (isImportRefusal(e)) return reply.status(403).send({ error: { code: e.code, message: e.message } })
      throw e
    }
    if (spent) {
      const detail = result.ok ? { kind: "download_completed" as const, detail: { url: result.url } } : { kind: "download_failed" as const, detail: { code: result.code } }
      recordEvent({ confirmationId: spent, ...detail, lane: "route", requestId: req.id }).catch(() => undefined)
    }
    if (!result.ok) {
      return reply.status(result.status).send({
        error: { code: result.code, message: result.message, ...(result.details ?? {}) },
      })
    }

    const { ok: _ok, ...data } = result
    return { data }
  })
}

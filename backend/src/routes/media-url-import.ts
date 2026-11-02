import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { formatZodError } from "../lib/zod-error.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { importRecordingFromUrl } from "../lib/media-url-import.js"
import { isImportRefusal, requireImportAllowed, spendImportConfirmation } from "../lib/import-gate.js"
import { recordEvent } from "../lib/content-rights.js"

/**
 * POST /v1/media/import-recording — import a remote AUDIO/VIDEO recording (up to
 * the podcast ceiling) into the caller's storage. The long-file ingest lane for
 * the podcast-editing primitives (Q7 option C): a browser can't upload a
 * multi-GB file (500 MB web cap) and presigned direct-to-R2 is CI-forbidden, so
 * the backend fetches the user-hosted URL server-side (SSRF-gated, streamed,
 * policed) and lands it on R2 — after which it behaves like any uploaded asset.
 *
 * An import of a link, so an ENGINE of the import gate (`lib/import-gate.ts`):
 * the site's policy and the content rights confirmation are checked before
 * anything is fetched (403 with the gate's code), the confirmation spent once
 * the import slot is held and right before the fetch (the lib's
 * `beforeFetch`, so a `429 too_many_imports` never spends it), and the
 * import's end noted on it. A fetch that fails afterwards has spent the
 * confirmation: the one-use lock is atomic, so every spend has an attempt
 * behind it.
 *
 * Body:      { url: string, confirmationId?: string }   (http(s); `safeUrlSchema` + `safeFetch` SSRF gates)
 * Response:  { data: { url, assetId, mimeType, sizeBytes, durationSec, kind, filename } }
 * Errors:    400 validation_error (not audio/video / undecodable),
 *            403 upload_blocked (deployment policy) | import_source_disabled | rights_confirmation_* (the gate),
 *            413 file_too_large | duration_exceeded | storage_limit_exceeded,
 *            422 fetch_failed (unreachable / non-2xx origin),
 *            429 too_many_imports (the slot; the confirmation is kept).
 *
 * All fetch/validation/storage semantics live in lib/media-url-import.ts.
 */

export const mediaImportRecordingBody = z.object({
  url: safeUrlSchema,
  // The content rights confirmation this import is made under
  // (`POST /v1/content-rights/confirm`). Optional until `content_rights_required` is on.
  confirmationId: z.string().uuid().optional(),
})

export async function mediaUrlImportRoutes(app: FastifyInstance) {
  app.post(
    "/v1/media/import-recording",
    // A server-side multi-GB fetch is expensive; cap request rate on top of the
    // per-user/global in-flight caps in the lib.
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      const parsed = mediaImportRecordingBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { url, confirmationId } = parsed.data
      const rights = { userId, confirmationId, lane: "route" as const, requestId: req.id }

      // Cancel the server-side download if the client hangs up — a
      // disconnected request must not keep streaming for 40 minutes.
      const ac = new AbortController()
      req.raw.on("close", () => ac.abort())

      let result: Awaited<ReturnType<typeof importRecordingFromUrl>>
      try {
        await requireImportAllowed(url, rights)
        result = await importRecordingFromUrl(userId, url, { signal: ac.signal, beforeFetch: () => spendImportConfirmation(url, rights) })
      } catch (e) {
        if (isImportRefusal(e)) return reply.status(403).send({ error: { code: e.code, message: e.message } })
        throw e
      }
      // A 429 never reached the fetch, so nothing was spent and nothing is noted.
      if (confirmationId && (result.ok || result.status !== 429)) {
        const detail = result.ok ? { kind: "download_completed" as const, detail: { url: result.url } } : { kind: "download_failed" as const, detail: { code: result.code } }
        recordEvent({ confirmationId, ...detail, lane: "route", requestId: req.id }).catch(() => undefined)
      }
      if (!result.ok) {
        return reply.status(result.status).send({
          error: { code: result.code, message: result.message, ...(result.details ?? {}) },
        })
      }

      const { ok: _ok, ...data } = result
      return { data }
    },
  )
}

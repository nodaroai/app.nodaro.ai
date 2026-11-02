import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema, isAllowedSocialVideoUrl, isDirectVideoFileUrl } from "../lib/url-validator.js"
import { ContentRightsError, createConfirmation, currentDeclaration } from "../lib/content-rights.js"
import { clientAddress } from "../lib/client-address.js"
import { firstHeaderValue } from "../lib/request-helpers.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { rateLimiter } from "../middleware/rate-limit.js"
import type { RightsLane } from "../lib/content-rights.js"

/**
 * Content rights (migration 577; lib/content-rights.ts):
 *
 *   GET  /v1/content-rights/declaration — the text a person confirms and its
 *        version. Public: a client shows it before anyone signs in.
 *   POST /v1/content-rights/confirm     — records that the signed-in account
 *        confirmed the current declaration for one link; answers the
 *        confirmation id a download then carries (`confirmationId` on
 *        `POST /v1/download-video`). One id, one download, within an hour.
 *
 * Whether a download WITHOUT a confirmation is refused is the app setting
 * `content_rights_required` (off by default): the server accepts before it
 * requires, so every client adds its checkbox at its own pace.
 */
const confirmBody = z.strictObject({
  url: safeUrlSchema.refine((url) => isAllowedSocialVideoUrl(url) || isDirectVideoFileUrl(url), {
    message: "Must be a link to a video's page or a direct video file URL",
  }),
  declarationVersion: z.number().int().min(1),
})

/** Where the confirmation was made, from how the caller signed in. */
function laneOf(authKind: string | undefined): RightsLane {
  if (authKind === "app_token") return "app"
  if (authKind === "api_token" || authKind === "billing_key") return "api"
  if (authKind === "internal") return "run"
  return "editor"
}

export async function contentRightsRoutes(app: FastifyInstance) {
  // A record is written per call into tables that are never cleaned up: a
  // person confirms a few links a minute at most, never hundreds.
  const confirmLimit = rateLimiter({ windowMs: 60_000, max: 30, keyPrefix: "content-rights-confirm", failClosed: true })

  app.get("/v1/content-rights/declaration", async (req, reply) => {
    try {
      const declaration = await currentDeclaration()
      return { data: { version: declaration.version, text: declaration.text } }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the declaration")
    }
  })

  app.post("/v1/content-rights/confirm", { preHandler: confirmLimit }, async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const parsed = confirmBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    const grant = req.appAuthorization
    try {
      const confirmation = await createConfirmation({
        userId: req.userId,
        url: parsed.data.url,
        declarationVersion: parsed.data.declarationVersion,
        lane: laneOf(req.authKind),
        appId: grant?.appId ?? null,
        authorizationId: grant?.authorizationId ?? null,
        clientAddress: clientAddress(req),
        userAgent: firstHeaderValue(req.headers["user-agent"]) ?? null,
        requestId: req.id,
      })
      return reply.status(201).send({ data: confirmation })
    } catch (e) {
      if (e instanceof ContentRightsError) return reply.status(409).send({ error: { code: e.code, message: e.message } })
      return sendInternalError(reply, req, e, "Failed to record the confirmation")
    }
  })
}

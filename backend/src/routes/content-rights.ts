import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema, isAllowedSocialVideoUrl, isDirectVideoFileUrl } from "../lib/url-validator.js"
import {
  ContentRightsError,
  createConfirmation,
  createStandingAuthorization,
  currentDeclaration,
  currentStandingAuthorization,
  revokeStandingAuthorization,
} from "../lib/content-rights.js"
import { importViaOf } from "../lib/import-via.js"
import { clientAddress } from "../lib/client-address.js"
import { firstHeaderValue } from "../lib/request-helpers.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { rateLimiter } from "../middleware/rate-limit.js"
import { requireAppWriteScope } from "../lib/scope-prehandler.js"
import type { RightsLane } from "../lib/content-rights.js"

/**
 * Content rights (migrations 577 + 579; lib/content-rights.ts):
 *
 *   GET    /v1/content-rights/declaration   — the text a person confirms and its
 *          version. Public: a client shows it before anyone signs in.
 *   POST   /v1/content-rights/confirm       — records that the signed-in account
 *          confirmed the current declaration for one link; answers the
 *          confirmation id a download then carries (`confirmationId` on
 *          `POST /v1/download-video`). One id, one download, within an hour.
 *   GET    /v1/content-rights/authorization — the account's standing authorization
 *          for imports through its API keys and AI agents: `{ data: null }` when
 *          there is none (a revoked one, or one made under an older declaration).
 *   POST   /v1/content-rights/authorization — records one for the current
 *          declaration (`{ declarationVersion }`); the person's own session only.
 *   DELETE /v1/content-rights/authorization — revokes it (the record stays).
 *
 * Whether a download WITHOUT a confirmation is refused is the app setting
 * `content_rights_required` (off by default): the server accepts before it
 * requires, so every client adds its checkbox at its own pace. A key's or an
 * agent's import never has a box: with a standing authorization each of its
 * imports is recorded as a confirmation derived from it (`lib/import-gate.ts`).
 */
const confirmBody = z.strictObject({
  url: safeUrlSchema.refine((url) => isAllowedSocialVideoUrl(url) || isDirectVideoFileUrl(url), {
    message: "Must be a link to a video's page or a direct video file URL",
  }),
  declarationVersion: z.number().int().min(1),
})

const authorizeBody = z.strictObject({
  declarationVersion: z.number().int().min(1),
})

/** Where the confirmation was made, from how the caller signed in. */
function laneOf(req: Parameters<typeof importViaOf>[0]): RightsLane {
  const via = importViaOf(req)
  if (via === "app" || via === "api" || via === "mcp") return via
  if (req.authKind === "internal") return "run"
  return "editor"
}

export async function contentRightsRoutes(app: FastifyInstance) {
  // A record is written per call into tables that are never cleaned up. One
  // confirmation opens one download, and a Video URL node fetches two per
  // link (the video and its sound) — a person ticking a canvas of them, or a
  // Run fetching for many at once, is a few dozen a minute; never hundreds.
  const confirmLimit = rateLimiter({ windowMs: 60_000, max: 120, keyPrefix: "content-rights-confirm", failClosed: true })
  // An authorization is made a few times in an account's life.
  const authorizeLimit = rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: "content-rights-authorize", failClosed: true })

  app.get("/v1/content-rights/declaration", async (req, reply) => {
    try {
      const declaration = await currentDeclaration()
      return { data: { version: declaration.version, text: declaration.text } }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the declaration")
    }
  })

  // A confirmation is made in the account's name, and opens an import into its
  // files: a connected app needs a scope that lets it write, as the import does.
  app.post("/v1/content-rights/confirm", { preHandler: [requireAppWriteScope(), confirmLimit] }, async (req, reply) => {
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
        lane: laneOf(req),
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

  app.get("/v1/content-rights/authorization", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    try {
      const standing = await currentStandingAuthorization(req.userId)
      return { data: standing ? { id: standing.id, declarationVersion: standing.declarationVersion, createdAt: standing.createdAt } : null }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the authorization")
    }
  })

  // The person's own decision, in their own session: a key or an agent cannot
  // authorize itself, a connected app cannot widen what it was granted, and no
  // internal hop (a run's, a plugin's) stands for the person — the auth kind
  // itself, never a way-in header, decides.
  app.post("/v1/content-rights/authorization", { preHandler: authorizeLimit }, async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    if (req.authKind !== "jwt") {
      return reply.status(403).send({ error: { code: "forbidden", message: "A standing authorization is given by the person, in their own session." } })
    }
    const parsed = authorizeBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    try {
      const standing = await createStandingAuthorization({
        userId: req.userId,
        declarationVersion: parsed.data.declarationVersion,
        clientAddress: clientAddress(req),
        userAgent: firstHeaderValue(req.headers["user-agent"]) ?? null,
      })
      return reply.status(201).send({ data: { id: standing.id, declarationVersion: standing.declarationVersion, createdAt: standing.createdAt } })
    } catch (e) {
      if (e instanceof ContentRightsError) return reply.status(409).send({ error: { code: e.code, message: e.message } })
      return sendInternalError(reply, req, e, "Failed to record the authorization")
    }
  })

  app.delete("/v1/content-rights/authorization", { preHandler: authorizeLimit }, async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    if (req.authKind !== "jwt") {
      return reply.status(403).send({ error: { code: "forbidden", message: "A standing authorization is revoked by the person, in their own session." } })
    }
    try {
      const revoked = await revokeStandingAuthorization(req.userId)
      return { data: { revoked: revoked > 0 } }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to revoke the authorization")
    }
  })
}

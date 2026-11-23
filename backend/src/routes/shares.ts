/**
 * Share links (migration 680): one result, a generation session or a project,
 * shared view-only by an unguessable link.
 *
 *   GET  /v1/shares?kind=&targetId=          the owner's link for one item (or null)
 *   PUT  /v1/shares                           turn it on or off; "allow copy"
 *   GET  /v1/public/shares/:token             PUBLIC: what the link shows
 *   GET  /v1/public/shares/:token/items       PUBLIC: a session's results, a page at a time
 *
 * The owner routes act on the caller's own items only: another person's id is
 * a 404, never a hint that it exists. The public routes take no credential —
 * the token is the capability, as on a presentation link (routes/presentation.ts)
 * — and are limited per network like the other public reads. A link that is
 * turned off, unknown, or whose item is gone or may no longer be shown is a 404;
 * so is every link on a deployment that does not allow public work.
 *
 * Every database read lives in lib/share-links/ and scopes to the owner.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { sendInternalError } from "../lib/http-errors.js"
import { formatZodError } from "../lib/zod-error.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { surfaceAllowsPublicOutputs } from "../lib/surface-profile.js"
import { getShareQuery, publicItemsQuery, publicShareParams, setShareBody } from "../lib/share-links/schemas.js"
import { ShareLinksUnavailableError, findOwnShare, setShare, toShare } from "../lib/share-links/store.js"
import { findShownShare, publicReadLimit } from "../lib/share-links/public-gate.js"
import { findOwnTarget, targetShareRefusal } from "../lib/share-links/owner-targets.js"
import { readPublicItems, readPublicShare } from "../lib/share-links/public-reads.js"
import { normalizeShareLocale } from "../lib/share-links/card-locale.js"
import { warmShareCard } from "../lib/share-links/card-warm.js"
import type { ShareLinkRow, ShareRefusal } from "../lib/share-links/types.js"
import { reader, unauthorized } from "./generation-sessions-http.js"
import "./shares-docs.js"

const WRITE_LIMIT = { rateLimit: { max: 30, timeWindow: "1 minute" } }

const REFUSAL_MESSAGES: Readonly<Record<ShareRefusal, string>> = {
  not_completed: "Only a finished result can be shared.",
  no_media: "This result has no image, video or sound to share.",
  private_output: "This result is kept private and cannot be shared.",
  content_filtered: "This result cannot be shared publicly.",
  restricted: "This result is not available for sharing.",
  workspace: "Work in a workspace cannot be shared by link.",
  sharing_disabled: "Sharing by link is not available on this server.",
}

function badRequest(reply: FastifyReply, error: Parameters<typeof formatZodError>[0]) {
  return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(error) } })
}

function notFound(reply: FastifyReply, message = "Not found") {
  return reply.status(404).send({ error: { code: "not_found", message } })
}

/** A public answer is never kept by a cache: turning a link off must take effect at once. */
function publicHeaders(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store")
  reply.header("X-Robots-Tag", "noindex")
}

/** The live link a public request names, or null after a 404. */
async function liveShare(req: FastifyRequest, reply: FastifyReply): Promise<ShareLinkRow | null> {
  publicHeaders(reply)
  const params = publicShareParams.safeParse(req.params)
  // A deployment that does not allow public work has no public links (lib/surface-profile.ts).
  if (!params.success || !surfaceAllowsPublicOutputs()) {
    notFound(reply, "Shared link not found")
    return null
  }
  // A blocked or suspended account's links show nothing while it is.
  const share = await findShownShare(params.data.token)
  if (!share) {
    notFound(reply, "Shared link not found")
    return null
  }
  return share
}

export async function shareRoutes(app: FastifyInstance) {
  app.get("/v1/shares", async (req, reply) => {
    const userId = reader(req, reply)
    if (!userId) return
    const parsed = getShareQuery.safeParse(req.query)
    if (!parsed.success) return badRequest(reply, parsed.error)
    try {
      const { kind, targetId } = parsed.data
      // A job in the Trash keeps its link (off on the public side): its owner still reads it, and can turn it off.
      if (!(await findOwnTarget(userId, kind, targetId, { withTrashed: true }))) return notFound(reply)
      const row = await findOwnShare(userId, kind, targetId)
      return reply.send({ data: row ? toShare(row) : null })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to read the share link")
    }
  })

  // An OAuth app needs to be able to read the user's work as well as write: turning a link on hands its
  // token back, and the token reads what the link shows.
  app.put("/v1/shares", { preHandler: [requireAppScope("assets:write"), requireAppScope("jobs:read")], config: WRITE_LIMIT }, async (req, reply) => {
    if (!req.userId) return unauthorized(reply)
    const parsed = setShareBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)
    const { kind, targetId, shared, allowCopy } = parsed.data
    const locale = normalizeShareLocale(parsed.data.locale) ?? undefined
    try {
      // Off reaches a job in the Trash too (else its link would come back with the job); on never does.
      const target = await findOwnTarget(req.userId, kind, targetId, { withTrashed: !shared })
      if (!target) return notFound(reply)
      // Turning a link off is always allowed; turning one on asks whether the item may be shown.
      const refusal = shared ? targetShareRefusal(target) : null
      if (refusal) {
        return reply.status(422).send({ error: { code: "share_not_allowed", reason: refusal, message: REFUSAL_MESSAGES[refusal] } })
      }
      const row = await setShare({
        ownerId: req.userId,
        kind,
        targetId,
        shared,
        ...(allowCopy !== undefined ? { allowCopy } : {}),
        ...(locale !== undefined ? { locale } : {}),
      })
      // The link's preview picture is rendered now, in the background (lib/share-links/card-warm.ts).
      if (shared) void warmShareCard(row)
      return reply.send({ data: toShare(row) })
    } catch (err) {
      if (err instanceof ShareLinksUnavailableError) {
        return reply.status(503).send({ error: { code: err.code, message: err.message } })
      }
      return sendInternalError(reply, req, err, "Failed to update the share link")
    }
  })

  app.get("/v1/public/shares/:token", { config: publicReadLimit(60) }, async (req, reply) => {
    try {
      const share = await liveShare(req, reply)
      if (!share) return
      const shown = await readPublicShare(share)
      if (!shown) return notFound(reply, "Shared link not found")
      return reply.send({ data: shown })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to read the shared link")
    }
  })

  app.get("/v1/public/shares/:token/items", { config: publicReadLimit(120) }, async (req, reply) => {
    try {
      const share = await liveShare(req, reply)
      if (!share) return
      const parsed = publicItemsQuery.safeParse(req.query)
      if (!parsed.success) return badRequest(reply, parsed.error)
      const { sessionId, cursor, limit = 50 } = parsed.data
      const answer = await readPublicItems(share, { ...(sessionId ? { sessionId } : {}), ...(cursor ? { cursor } : {}), limit })
      if (!answer.ok) return reply.status(answer.status).send({ error: { code: answer.code, message: answer.message } })
      return reply.send({ data: answer.data, nextCursor: answer.nextCursor })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to read the shared link")
    }
  })
}

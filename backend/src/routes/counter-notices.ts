import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { formatZodError } from "../lib/zod-error.js"
import { clientNetworkHash } from "../lib/client-address.js"
import { firstHeaderValue } from "../lib/request-helpers.js"
import { sendInternalError } from "../lib/http-errors.js"
import { listMyRestrictions } from "../lib/my-restrictions.js"
import {
  COUNTER_NOTICE_DECLARATION,
  COUNTER_NOTICE_DECLARATION_HASH,
  CounterNoticeError,
  createCounterNotice,
  hasRefusedCharacters,
  normalizeLineBreaks,
  type CounterNoticeErrorCode,
} from "../lib/counter-notices.js"

/**
 * The owner's side of a restriction (lib/my-restrictions.ts,
 * lib/counter-notices.ts): what a complaint led to on their content, and the
 * counter-notice that answers it. A counter-notice is a sworn statement, so
 * every route here answers the person in their own session only: an API key,
 * an app's token or an agent is refused (`in_app_only`), and none of them may
 * swear for the person.
 *
 *   GET  /v1/content-restrictions/mine                — the restrictions on my content a complaint led to
 *   GET  /v1/counter-notices/declaration              — the declaration, verbatim, and its hash
 *   POST /v1/content-restrictions/:id/counter-notice  — the counter-notice for one of them
 */

const IN_APP_ONLY = {
  error: { code: "in_app_only", message: "A counter-notification is sent by the person, signed in to the app." },
}

const READS = { rateLimit: { max: 60, timeWindow: "1 minute" } }
const SUBMITS = { rateLimit: { max: 10, timeWindow: "1 hour" } }

/** One line of plain text: forwarded to the complainant as written, so no control character and no invisible mark. */
const line = (max: number) =>
  z.string().trim().min(1).max(max).refine((value) => !hasRefusedCharacters(value, { lineBreaks: false }), { message: "Plain text on one line" })
/** Plain text that may break lines (as line feeds, whatever the client sent), nothing more. */
const lines = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" ? normalizeLineBreaks(value) : value),
    z.string().trim().min(1).max(max).refine((value) => !hasRefusedCharacters(value, { lineBreaks: true }), { message: "Plain text" }),
  )

const counterNoticeBody = z.strictObject({
  name: line(200),
  email: z.string().trim().email().max(320),
  address: lines(1000),
  phone: line(60),
  signature: line(200),
  contentIdentification: lines(4000),
  locationBefore: lines(4000),
  declarationHash: z.string().regex(/^[0-9a-f]{64}$/),
  perjury: z.literal(true),
  jurisdiction: z.literal(true),
})

const idParams = z.object({ id: z.string().uuid() })

const STATUS_OF: Readonly<Record<CounterNoticeErrorCode, number>> = {
  unavailable: 503,
  not_found: 404,
  not_copyright: 409,
  lifted: 409,
  case_closed: 409,
  already_sent: 409,
  declaration_changed: 409,
}

/** Signed in to the app, or refused; answers the refusal it sent. */
function refuseOutsideTheApp(req: FastifyRequest, reply: FastifyReply): FastifyReply | null {
  if (!req.userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
  if (req.authKind !== "jwt") return reply.status(403).send(IN_APP_ONLY)
  return null
}

/** Registers the owner's restriction and counter-notice routes (see the module comment). */
export async function counterNoticesRoutes(app: FastifyInstance) {
  // A person's details and their content's restrictions: no cache keeps any of it.
  app.addHook("onRequest", async (_req, reply) => {
    reply.header("Cache-Control", "no-store")
  })

  app.get("/v1/content-restrictions/mine", { config: READS }, async (req, reply) => {
    const refused = refuseOutsideTheApp(req, reply)
    if (refused) return refused
    try {
      return { data: await listMyRestrictions(req.userId!) }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read your restrictions")
    }
  })

  app.get("/v1/counter-notices/declaration", { config: READS }, async (req, reply) => {
    const refused = refuseOutsideTheApp(req, reply)
    if (refused) return refused
    return { data: { paragraphs: COUNTER_NOTICE_DECLARATION, hash: COUNTER_NOTICE_DECLARATION_HASH } }
  })

  app.post("/v1/content-restrictions/:id/counter-notice", { config: SUBMITS }, async (req, reply) => {
    const refused = refuseOutsideTheApp(req, reply)
    if (refused) return refused
    const params = idParams.safeParse(req.params)
    if (!params.success) return reply.status(404).send({ error: { code: "not_found", message: "No such restriction on your account" } })
    const parsed = counterNoticeBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    const body = parsed.data
    try {
      const receipt = await createCounterNotice({
        userId: req.userId!,
        restrictionId: params.data.id,
        name: body.name,
        email: body.email,
        address: body.address,
        phone: body.phone,
        signature: body.signature,
        contentIdentification: body.contentIdentification,
        locationBefore: body.locationBefore,
        declarationHash: body.declarationHash,
        networkHash: clientNetworkHash(req),
        userAgent: firstHeaderValue(req.headers["user-agent"]) ?? null,
      })
      return reply.status(201).send({
        data: { reference: receipt.reference, receivedAt: receipt.receivedAt, opensOn: receipt.window.opensOn, closesOn: receipt.window.closesOn },
      })
    } catch (e) {
      if (e instanceof CounterNoticeError) return reply.status(STATUS_OF[e.code]).send({ error: { code: e.code, message: e.message } })
      return sendInternalError(reply, req, e, "Failed to record the counter-notification")
    }
  })
}

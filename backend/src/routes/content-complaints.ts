import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { formatZodError } from "../lib/zod-error.js"
import { config } from "../lib/config.js"
import { clientNetworkHash, rateLimitAddressKey } from "../lib/client-address.js"
import { firstHeaderValue } from "../lib/request-helpers.js"
import { sendInternalError } from "../lib/http-errors.js"
import {
  ACCURACY_STATEMENT,
  COMPLAINT_CATEGORIES,
  GOOD_FAITH_STATEMENT,
  RightsComplaintError,
  USER_AGENT_MAX,
  complainantEmailHash,
  createComplaint,
  recentComplaintsByEmail,
  recordComplaintEventQuietly,
  verifyComplaint,
} from "../lib/rights-complaints.js"
import { sendComplaintAcknowledgment, sendComplaintVerification } from "../lib/complaint-mail.js"

/**
 * The public complaints form (migration 580; lib/rights-complaints.ts). All
 * three routes are public: a complainant has no account here.
 *
 *   GET  /v1/content-complaints/statements — the two statements a copyright
 *        notice affirms, verbatim, for the form to show.
 *   POST /v1/content-complaints — a copyright notice (the twelve fields, both
 *        statements affirmed) or another complaint (one of the categories).
 *        Opens a case at once and answers its reference; the complainant then
 *        proves their email with the link sent to them. The answer is the SAME
 *        whatever the links name — a case is opened whether or not we hold
 *        the content, so the form reveals nothing about what we hold — and
 *        once the case exists nothing that follows (the email, the log) can
 *        turn the answer into a failure.
 *   GET  /v1/content-complaints/verify?token= — the one-time link: marks the
 *        case verified, sends the acknowledgment, and sends the person to the
 *        form's page with the outcome. An unknown or expired token gets the
 *        same page with `verified=invalid`; a link opened before (a mail
 *        scanner's prefetch) answers `ok` again without a second email.
 *
 * Nothing a complainant writes is fetched: links are matched against our own
 * records as text, never requested. The verify token is redacted from the
 * request log (lib/log-redaction.ts).
 */

const text = (max: number) => z.string().trim().min(1).max(max)
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined))
const link = z
  .string()
  .trim()
  .max(4000)
  .refine((v) => /^https?:\/\//i.test(v), { message: "Must be an http(s) link" })

const common = {
  name: text(200),
  email: z.string().trim().email().max(320),
  reportedContent: text(8000),
  explanation: text(8000),
  /** A field only a form-filling bot fills. */
  website: z.string().max(200).optional(),
}

const copyrightBody = z.strictObject({
  kind: z.literal("copyright"),
  ...common,
  address: text(500),
  phone: text(60),
  claimantRole: z.enum(["owner", "agent"]),
  originalWork: text(4000),
  originalWorkUrl: link.optional(),
  signature: text(200),
  goodFaith: z.literal(true),
  accuracy: z.literal(true),
})

const otherBody = z.strictObject({
  kind: z.literal("other"),
  ...common,
  category: z.enum(COMPLAINT_CATEGORIES.filter((c) => c !== "copyright_infringement") as [string, ...string[]]),
  address: optionalText(500),
  phone: optionalText(60),
})

const complaintBody = z.discriminatedUnion("kind", [copyrightBody, otherBody])

const verifyQuery = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) })

/** The most verification emails one address is sent in a day; the cases beyond it are still opened. */
const RECIPIENT_MAIL_CAP_PER_DAY = 3

/** Where the form lives; the verify link lands there with the outcome. */
function formPage(outcome: "ok" | "invalid"): string {
  const base = config.PUBLIC_URL ? config.PUBLIC_URL.replace(/\/$/, "") : ""
  return `${base}/copyright-complaints?verified=${outcome}`
}

/**
 * The verify link, from the deployment's own address only: a link built from
 * the request's Host header would let a caller mail the complainant a link to
 * a host of the caller's choosing. No address, no link, no email.
 */
function verifyLink(token: string): string | null {
  if (!config.PUBLIC_URL) return null
  return `${config.PUBLIC_URL.replace(/\/$/, "")}/v1/content-complaints/verify?token=${token}`
}

export async function contentComplaintsRoutes(app: FastifyInstance) {
  app.get("/v1/content-complaints/statements", async () => ({
    data: { goodFaith: GOOD_FAITH_STATEMENT, accuracy: ACCURACY_STATEMENT },
  }))

  app.post(
    "/v1/content-complaints",
    {
      // The fields' own limits are in characters; a notice written in a
      // three-byte script at every limit is around 60 KB.
      bodyLimit: 128_000,
      // Per network, in the global limiter's own store (in memory, per
      // replica): a first fence, not the only one — the per-recipient mail
      // cap and the honeypot below are the others.
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "10 minutes",
          keyGenerator: (req: FastifyRequest) => rateLimitAddressKey(req),
        },
      },
    },
    async (req, reply) => {
      const parsed = complaintBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }
      const body = parsed.data
      // The hidden field was filled: a bot, or a browser that filled it for a
      // person. The case opens either way, flagged for the handler, and no
      // email goes out for it; the answer is the same as any other.
      const honeypot = Boolean(body.website)

      let receipt: Awaited<ReturnType<typeof createComplaint>>
      try {
        receipt = await createComplaint({
          kind: body.kind,
          category: body.kind === "copyright" ? "copyright_infringement" : (body.category as never),
          name: body.name,
          email: body.email,
          address: body.address,
          phone: body.phone,
          ...(body.kind === "copyright"
            ? {
                claimantRole: body.claimantRole,
                originalWork: body.originalWork,
                originalWorkUrl: body.originalWorkUrl,
                signature: body.signature,
                statementsAffirmed: true,
              }
            : {}),
          reportedContent: body.reportedContent,
          explanation: body.explanation,
          honeypot,
          networkHash: clientNetworkHash(req),
          userAgent: firstHeaderValue(req.headers["user-agent"])?.slice(0, USER_AGENT_MAX) ?? null,
        })
      } catch (e) {
        if (e instanceof RightsComplaintError) {
          return reply.status(503).send({ error: { code: e.code, message: e.message } })
        }
        return sendInternalError(reply, req, e, "Failed to record the complaint")
      }

      // The case exists; the email is best effort and its outcome is on the case.
      if (!honeypot) {
        try {
          const url = verifyLink(receipt.verificationToken)
          const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
          const recent = url ? await recentComplaintsByEmail(complainantEmailHash(body.email), since) : 0
          const mail = !url
            ? ({ sent: false, reason: "no_public_url" } as const)
            : recent > RECIPIENT_MAIL_CAP_PER_DAY
              ? ({ sent: false, reason: "recipient_cap" } as const)
              : await sendComplaintVerification({ email: body.email, reference: receipt.reference, verifyUrl: url })
          if (mail.sent) {
            await recordComplaintEventQuietly(receipt.id, "verification_sent", "system", { messageId: mail.messageId })
          } else {
            req.log.warn({ reference: receipt.reference, reason: mail.reason }, "[content-complaints] verification email not sent")
            await recordComplaintEventQuietly(receipt.id, "mail_unavailable", "system", { mail: "verification", reason: mail.reason })
          }
        } catch (e) {
          req.log.error({ reference: receipt.reference, err: e }, "[content-complaints] verification email failed")
          await recordComplaintEventQuietly(receipt.id, "mail_unavailable", "system", { mail: "verification", reason: "failed" })
        }
      }
      return reply.status(202).send({ data: { reference: receipt.reference, verificationRequired: true } })
    },
  )

  app.get(
    "/v1/content-complaints/verify",
    {
      config: {
        rateLimit: { max: 20, timeWindow: "10 minutes", keyGenerator: (req: FastifyRequest) => rateLimitAddressKey(req) },
      },
    },
    async (req, reply) => {
      const parsed = verifyQuery.safeParse(req.query)
      if (!parsed.success) return reply.redirect(formPage("invalid"), 303)
      let verified: Awaited<ReturnType<typeof verifyComplaint>>
      try {
        verified = await verifyComplaint(parsed.data.token)
      } catch (e) {
        req.log.error({ err: e }, "[content-complaints] verification failed")
        return reply.redirect(formPage("invalid"), 303)
      }
      if (!verified) return reply.redirect(formPage("invalid"), 303)
      // The case is verified; the acknowledgment is best effort, once.
      if (!verified.alreadyVerified) {
        try {
          const mail = await sendComplaintAcknowledgment({ email: verified.email, reference: verified.reference })
          if (mail.sent) {
            await recordComplaintEventQuietly(verified.id, "acknowledgment_sent", "system", { messageId: mail.messageId })
          } else {
            req.log.warn({ reference: verified.reference, reason: mail.reason }, "[content-complaints] acknowledgment email not sent")
            await recordComplaintEventQuietly(verified.id, "mail_unavailable", "system", { mail: "acknowledgment", reason: mail.reason })
          }
        } catch (e) {
          req.log.error({ reference: verified.reference, err: e }, "[content-complaints] acknowledgment email failed")
          await recordComplaintEventQuietly(verified.id, "mail_unavailable", "system", { mail: "acknowledgment", reason: "failed" })
        }
      }
      return reply.redirect(formPage("ok"), 303)
    },
  )
}

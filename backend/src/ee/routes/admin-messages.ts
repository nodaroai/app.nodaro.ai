import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { r2KeyFromOurUrl, getR2ObjectSize } from "../../lib/storage.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { isLoopsConfigured, sendTransactional } from "../lib/loops-client.js"
import {
  ADMIN_MESSAGE_TEMPLATES,
  adminMessageTemplateId,
  parseAdminMessage,
} from "../lib/admin-message-templates.js"
import {
  dailyWindowStart,
  getAdminMessagesDailyLimit,
} from "../lib/admin-message-config.js"

/**
 * Admin → user email, sent from inside Nodaro.
 *
 * THE LOG IS THE FEATURE. Loops is a pipe we cannot query per-user and whose
 * retention is not ours, so every send writes an `admin_messages` row BEFORE
 * the provider call and updates it with the outcome. A process that dies
 * mid-send therefore leaves a row saying "sending" — delivery unknown — rather
 * than no evidence at all. Failures are rows too: "we tried to tell them and it
 * bounced" is a fact about this user's history.
 *
 * TRANSACTIONAL, NOT MARKETING. These go to any user regardless of marketing
 * consent because they are service messages about that person's own account.
 * That licence is exactly as wide as the templates are: an admin picks from
 * three service templates and fills in blanks — there is no free-form HTML
 * surface here, and `sendTransactional` pins `addToAudience: false` so a
 * support email never grows the marketing list.
 *
 * Everything is `requireAdmin`. Not `requirePlatformOperator`: sending a
 * service email costs no credits and mints nothing, and a customer-federated
 * deployment's own admins emailing their own users is the intended use.
 */

/** The path param is `:id` to match every sibling under /v1/admin/users —
 *  a differently-named parameter in the same position is a router-level
 *  question nobody should have to answer twice. */
const userParams = z.object({ id: z.uuid() })

const composeBody = z.object({
  templateId: adminMessageTemplateId,
  /** Template-specific fields; shape is enforced by the template's own schema. */
  variables: z.record(z.string(), z.unknown()).default({}),
})

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

/** Screenshot cap. Generous for a screen grab, far below anything that would
 *  make an inbox unhappy — and this is a LINK in the email, so the ceiling is
 *  about our storage and the recipient's click, not the message size. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** Where `/v1/upload/image` puts things. An image URL that is ours but points
 *  somewhere else in the bucket did not come from the uploader. */
const UPLOAD_PREFIX = "uploads/"

const ALLOWED_IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "avif", "gif"])

/** Provider error text is for admins, not the recipient — but it still goes in
 *  a database column, so bound it. */
const MAX_ERROR_LEN = 500

interface MessageRow {
  id: string
  user_id: string | null
  recipient_email: string
  sent_by_admin_id: string | null
  sent_by_admin_email: string | null
  template_id: string
  variables: Record<string, unknown> | null
  rendered_subject: string
  rendered_body: string
  image_url: string | null
  loops_message_id: string | null
  status: string
  error_message: string | null
  sent_at: string
}

function toWire(row: MessageRow) {
  return {
    id: row.id,
    userId: row.user_id,
    recipientEmail: row.recipient_email,
    sentByAdminId: row.sent_by_admin_id,
    sentByAdminEmail: row.sent_by_admin_email,
    templateId: row.template_id,
    variables: row.variables ?? {},
    renderedSubject: row.rendered_subject,
    renderedBody: row.rendered_body,
    imageUrl: row.image_url,
    loopsMessageId: row.loops_message_id,
    status: row.status,
    errorMessage: row.error_message,
    sentAt: row.sent_at,
  }
}

/**
 * The screenshot must be an object WE hold, under the uploader's own prefix,
 * of an image type, within the cap.
 *
 * A URL is not a file. The compose form hands us a string, and without this the
 * "screenshot" could be any address at all — including one that loads on open
 * and reports back, inside an email carrying our From domain. Re-deriving the
 * key from the URL and HEADing the object is what turns the claim "this is the
 * screenshot I just uploaded" into something checked.
 *
 * The CTA link is deliberately NOT restricted this way: a call to action exists
 * to point somewhere, sometimes off-platform (a status page, a vendor's docs),
 * and the admin writes its visible label. The screenshot is different because
 * it claims to be a file we are hosting.
 */
async function validateImageUrl(url: string): Promise<string | null> {
  const key = r2KeyFromOurUrl(url)
  if (!key) return "The screenshot must be a file uploaded here"
  if (!key.startsWith(UPLOAD_PREFIX)) return "The screenshot must be a file uploaded here"
  const ext = key.split(".").pop()?.toLowerCase() ?? ""
  if (!ALLOWED_IMAGE_EXT.has(ext)) return "Unsupported image type"
  // Zero means "missing or unreadable" as well as "empty" — either way there is
  // nothing to link to, and an email pointing at a 404 is worse than no email.
  const size = await getR2ObjectSize(key)
  if (size <= 0) return "That screenshot is no longer in storage — upload it again"
  if (size > MAX_IMAGE_BYTES) return "Screenshot is too large (max 5 MB)"
  return null
}

export async function adminMessagesRoutes(app: FastifyInstance) {
  /**
   * GET /v1/admin/message-templates
   *
   * What the compose form renders itself from, plus whether sending can work at
   * all on this deployment. Without `loopsConfigured` the UI would show a Send
   * button that always fails, on an install that simply has no email provider.
   */
  app.get("/v1/admin/message-templates", { preHandler: requireAdmin }, async () => {
    return {
      data: {
        loopsConfigured: isLoopsConfigured(),
        dailyLimit: await getAdminMessagesDailyLimit(),
        templates: ADMIN_MESSAGE_TEMPLATES.map((t) => ({
          id: t.id,
          label: t.label,
          description: t.description,
          supportsImage: t.supportsImage,
          subjectIsAuthored: t.subjectIsAuthored,
        })),
      },
    }
  })

  /**
   * GET /v1/admin/users/:id/messages
   *
   * Every message any admin ever sent this user. Deliberately not scoped to the
   * caller: the next admin to open this user needs to see what the last one
   * already said.
   */
  app.get("/v1/admin/users/:id/messages", { preHandler: requireAdmin }, async (req, reply) => {
    const params = userParams.safeParse(req.params)
    if (!params.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid user id" } })
    }
    const query = historyQuery.safeParse(req.query ?? {})
    if (!query.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid query" } })
    }
    const { limit, offset } = query.data

    try {
      const { data, error, count } = await supabase
        .from("admin_messages")
        .select("*", { count: "exact" })
        .eq("user_id", params.data.id)
        .order("sent_at", { ascending: false })
        .range(offset, offset + limit - 1)

      if (error) {
        // Staging runs this code before migration 375 reaches the shared
        // database. An empty, flagged history beats a 500 the operator would
        // report as an outage.
        if (isMissingTableError(error)) {
          req.log.warn("admin_messages is not in the database yet — serving unavailable")
          return { data: [], total: 0, unavailable: true }
        }
        return sendInternalError(reply, req, error, "Failed to load the message history")
      }

      return {
        data: ((data ?? []) as MessageRow[]).map(toWire),
        total: count ?? 0,
      }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to load the message history")
    }
  })

  /**
   * POST /v1/admin/users/:id/messages/preview
   *
   * Renders through the SAME `parseAdminMessage` the send uses, so an approved
   * preview cannot differ from what goes out, and input the send would reject
   * can never render clean here.
   */
  app.post(
    "/v1/admin/users/:id/messages/preview",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const params = userParams.safeParse(req.params)
      if (!params.success) {
        return reply.status(400).send({ error: { code: "validation_error", message: "Invalid user id" } })
      }
      const body = composeBody.safeParse(req.body ?? {})
      if (!body.success) {
        return reply.status(400).send({
          error: { code: "validation_error", message: body.error.issues[0]?.message ?? "Invalid message" },
        })
      }

      const parsed = parseAdminMessage(body.data.templateId, body.data.variables)
      if (!parsed.ok) {
        return reply.status(400).send({ error: { code: "validation_error", message: parsed.message } })
      }

      return {
        data: {
          subject: parsed.value.subject,
          bodyHtml: parsed.value.bodyHtml,
          subjectIsAuthored: parsed.value.template.subjectIsAuthored,
        },
      }
    },
  )

  /**
   * POST /v1/admin/users/:id/messages
   *
   * Validate → check the daily limit → write the row → send → record the
   * outcome. In that order, and the order is the point: see the file header.
   */
  app.post("/v1/admin/users/:id/messages", { preHandler: requireAdmin }, async (req, reply) => {
    const params = userParams.safeParse(req.params)
    if (!params.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid user id" } })
    }
    const body = composeBody.safeParse(req.body ?? {})
    if (!body.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: body.error.issues[0]?.message ?? "Invalid message" },
      })
    }
    const adminId = req.userId
    if (!adminId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    // IN-APP ONLY, on the send. `requireAdmin` asks whether the caller IS an
    // admin, never how they authenticated — so an OAuth app the admin
    // authorized for some narrow scope, or a long-lived personal API token,
    // satisfies it too. For a read that is tolerable; for a button that puts
    // mail into a stranger's inbox over our verified domain it is not, because
    // the admin would never see it happen. Same gate and same shape as the
    // copilot's `in_app_only`.
    if (req.authKind !== "jwt") {
      return reply.status(403).send({
        error: {
          code: "in_app_only",
          message: "Messaging a user is available in the Nodaro admin panel only.",
        },
      })
    }

    // Refuse BEFORE writing a row: an install with no Loops key would otherwise
    // accumulate rows for mail that never had anywhere to go.
    if (!isLoopsConfigured()) {
      return reply.status(503).send({
        error: {
          code: "email_not_configured",
          message: "Email is not configured on this deployment (LOOPS_API_KEY is unset)",
        },
      })
    }

    try {
      // --- Recipient -------------------------------------------------------
      // FIRST, and before the render, because the render NEEDS it: all three
      // Loops templates open with the recipient's name, and Loops refuses a
      // send whose `firstName` is missing or empty. Looking the user up after
      // rendering is what produced a payload that could never be delivered.
      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .eq("id", params.data.id)
        .maybeSingle()
      if (profileErr) {
        return sendInternalError(reply, req, profileErr, "Failed to look up the user")
      }
      const recipientEmail = (profile as { email?: string | null } | null)?.email?.trim()
      if (!recipientEmail) {
        return reply.status(404).send({
          error: { code: "not_found", message: "That user has no email address on file" },
        })
      }

      // Validation, template capability and rendering all happen inside
      // `parseAdminMessage` — the SAME call the preview makes, so the two
      // surfaces cannot answer differently for the same input. It also refuses
      // a payload Loops would reject, so a template that has drifted from its
      // Loops counterpart fails here, naming the variable, instead of coming
      // back as an unexplained 502 after a row has already been written.
      const parsed = parseAdminMessage(body.data.templateId, body.data.variables, {
        fullName: (profile as { full_name?: string | null } | null)?.full_name ?? null,
      })
      if (!parsed.ok) {
        return reply.status(400).send({ error: { code: "validation_error", message: parsed.message } })
      }
      const { template, subject, bodyHtml, dataVariables, input } = parsed.value

      // `validateImageUrl` cannot throw today — both helpers it calls swallow
      // their own errors — but that is a fact about their internals, not a
      // contract, and an uncaught reject here would surface as an unhandled
      // 500 instead of a message the admin can act on. Hence: inside the try.
      const imageUrl =
        typeof input.imageUrl === "string" && input.imageUrl.length > 0 ? input.imageUrl : null
      if (imageUrl) {
        const problem = await validateImageUrl(imageUrl)
        if (problem) {
          return reply.status(400).send({ error: { code: "validation_error", message: problem } })
        }
      }

      // --- Daily limit -----------------------------------------------------
      const limit = await getAdminMessagesDailyLimit()
      const { count: sentToday, error: countErr } = await supabase
        .from("admin_messages")
        .select("id", { count: "exact", head: true })
        .eq("sent_by_admin_id", adminId)
        .gte("sent_at", dailyWindowStart())
        // A send the provider refused reached nobody, so it does not spend the
        // budget. A row still 'sending' does: it may well have been delivered,
        // and an unknown outcome must cost the same as a known one.
        //
        // This is check-then-act, not atomic: two requests from the same admin
        // arriving together can both read 49 against a limit of 50 and both
        // insert. That is accepted — the route is now jwt-only and single-admin,
        // so the racer is a double-click, and this limit is an abuse ceiling
        // rather than a money gate. Making it an invariant means moving the
        // count and the insert into one SECURITY DEFINER RPC under an advisory
        // lock, the way credit operations do it.
        .neq("status", "failed")
      if (countErr) {
        if (isMissingTableError(countErr)) {
          return reply.status(503).send({
            error: {
              code: "not_migrated",
              message: "Messaging is not available yet on this environment (migration pending)",
            },
          })
        }
        return sendInternalError(reply, req, countErr, "Failed to check the send limit")
      }
      if ((sentToday ?? 0) >= limit) {
        return reply.status(429).send({
          error: {
            code: "daily_limit_reached",
            message: `You have sent ${sentToday} of ${limit} messages today. The limit resets at 00:00 UTC.`,
          },
        })
      }

      // --- The record, written first --------------------------------------
      // The acting admin's address is DENORMALISED onto the row so a message
      // does not become anonymous when that admin leaves. A swallowed error
      // here would write null and make the history say "an admin who has since
      // been removed" about someone still employed — so it is logged, loudly,
      // rather than left to look like an empty column.
      const { data: adminProfile, error: adminProfileErr } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", adminId)
        .maybeSingle()
      if (adminProfileErr) {
        req.log.error(
          { err: adminProfileErr, adminId },
          "could not read the sending admin's email — the message row will not name them",
        )
      }

      const { data: inserted, error: insertErr } = await supabase
        .from("admin_messages")
        .insert({
          user_id: params.data.id,
          recipient_email: recipientEmail,
          sent_by_admin_id: adminId,
          sent_by_admin_email: (adminProfile as { email?: string | null } | null)?.email ?? null,
          template_id: template.id,
          variables: input,
          rendered_subject: subject,
          rendered_body: bodyHtml,
          image_url: imageUrl,
          status: "sending",
        })
        .select("*")
        .single()
      if (insertErr || !inserted) {
        return sendInternalError(reply, req, insertErr, "Failed to record the message")
      }
      const row = inserted as MessageRow

      // --- The send --------------------------------------------------------
      const result = await sendTransactional(template.transactionalId, recipientEmail, dataVariables)

      // Three outcomes, not two. A timeout or a dropped socket means we never
      // learned whether the email went — Loops may have accepted it and taken
      // 11 seconds to say so. Marking that `failed` would tell the admin the
      // provider refused it and invite a second send to the same person, and
      // (because failed rows do not spend the daily budget) would hand back the
      // quota to do it with. The row stays `sending`, which is the state this
      // schema has for exactly this: delivery unknown.
      const unconfirmed =
        !result.ok && (result.failureKind === "timeout" || result.failureKind === "network")

      const patch = result.ok
        ? { status: "sent", loops_message_id: result.messageId ?? null, error_message: null }
        : unconfirmed
          ? { error_message: (result.error ?? "no_response").slice(0, MAX_ERROR_LEN) }
          : { status: "failed", error_message: (result.error ?? "send_failed").slice(0, MAX_ERROR_LEN) }

      const { data: updated, error: updateErr } = await supabase
        .from("admin_messages")
        .update(patch)
        .eq("id", row.id)
        .select("*")
        .single()
      if (updateErr) {
        // The email's fate is already decided; only our note about it failed.
        // Log loudly and answer with what we know — never turn a delivered
        // message into a reported failure.
        req.log.error(
          { err: updateErr, messageId: row.id, delivered: result.ok },
          "admin message sent but the outcome could not be recorded",
        )
      }

      const finalRow = (updated as MessageRow | null) ?? { ...row, ...patch } as MessageRow

      if (unconfirmed) {
        req.log.error(
          { messageId: row.id, adminId, kind: result.failureKind, error: result.error },
          "admin message: no response from the email provider — delivery unknown",
        )
        return reply.status(504).send({
          error: {
            code: "send_unconfirmed",
            message:
              "The email provider did not answer in time, so we do not know whether this was delivered. " +
              "It is logged as still sending. Check with the recipient before sending it again.",
          },
          data: toWire(finalRow),
        })
      }

      if (!result.ok) {
        req.log.warn(
          { messageId: row.id, adminId, status: result.status, error: result.error },
          "admin message failed to send",
        )
        return reply.status(502).send({
          error: {
            code: "send_failed",
            message: "The email provider rejected the message. It is logged as failed.",
          },
          data: toWire(finalRow),
        })
      }

      req.log.info(
        { messageId: row.id, adminId, userId: params.data.id, templateId: template.id },
        "admin message sent",
      )
      return { data: toWire(finalRow) }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to send the message")
    }
  })
}

/**
 * Migrations reach the database only on a push to main, so staging serves this
 * code before `admin_messages` exists. PostgREST reports that as 42P01 / a
 * "does not exist" schema-cache miss.
 */
function isMissingTableError(error: { code?: string; message?: string }): boolean {
  if (error.code === "42P01" || error.code === "PGRST205") return true
  const msg = (error.message ?? "").toLowerCase()
  return msg.includes("admin_messages") && msg.includes("does not exist")
}

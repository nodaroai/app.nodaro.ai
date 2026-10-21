/**
 * /v1/webhook-endpoints — outbound webhooks (migration 521).
 *
 * Register an https address and Nodaro POSTs `job.completed` / `job.failed`
 * there, signed with the endpoint's own secret, retried with backoff, every
 * attempt kept in the endpoint's delivery log. The sender is the dispatcher
 * loop (lib/webhooks/dispatcher.ts); events are recorded by a trigger on
 * `jobs`, so no path that ends a job can skip one.
 *
 * NOT under /v1/webhooks: that prefix is public by design (the workflow
 * trigger `POST /v1/webhooks/:token`, token-is-auth). Every route here needs
 * a credential — a session, a personal API token, or a connected app's token
 * with `jobs:read` (an endpoint receives job data). A personal key limited to
 * some workflows reaches none of them (no workflowScope is declared).
 *
 * Owner-only, in this environment: every query is scoped to the caller's
 * user_id and to the environment that created the row (lib/webhooks/
 * endpoints.ts). A connected app's token reaches only the endpoints that app
 * registered, and such an endpoint receives only the jobs that app submitted.
 * A miss is always 404, so ids are no oracle.
 *
 * The signing secret is generated here, sealed before it is stored
 * (lib/webhooks/secret.ts), and returned twice only: by create and by
 * rotate-secret. No read selects the ciphertext.
 */
import { randomUUID } from "node:crypto"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { getRuntimeEnv } from "../lib/runtime-env.js"
import { EncryptionKeyMissingError } from "../lib/instance-cipher.js"
import { isMissingColumnError, isMissingFunctionError, isMissingTableError } from "../lib/postgrest-errors.js"
import { generateSigningSecret, sealSigningSecret } from "../lib/webhooks/secret.js"
import { WEBHOOK_JOB_EVENTS } from "../lib/webhooks/event-types.js"
import { describeDbError } from "../lib/webhooks/db-error.js"
import {
  DELIVERY_COLS,
  ENDPOINT_COLS,
  MAX_ENDPOINTS_PER_ACCOUNT,
  afterKeyset,
  callerOf,
  decodeCursor,
  encodeCursor,
  environmentFilter,
  findOwnEndpoint,
  toDeliveryResponse,
  childJobIdsOf,
  toEndpointResponse,
  type DeliveryRow,
  type EndpointCaller,
  type EndpointRow,
} from "../lib/webhooks/endpoints.js"
import {
  DEFAULT_GRACE_SECONDS,
  createEndpointBody,
  deliveryParams,
  idParams,
  listDeliveriesQuery,
  rotateSecretBody,
  updateEndpointBody,
  webhookUrl,
} from "../lib/webhooks/schemas.js"
// OpenAPI entries (module side effect, like every route file's registerPath).
import "./webhook-endpoints-docs.js"

const WRITE_LIMIT = { rateLimit: { max: 30, timeWindow: "1 minute" } }
const TEST_LIMIT = { rateLimit: { max: 10, timeWindow: "1 minute" } }
const DEFAULT_PAGE = 20

/** Every route: a connected app's token needs jobs:read (an endpoint receives job data). */
const scope = requireAppScope("jobs:read")

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({ error: { code: "not_found", message: "Webhook endpoint not found" } })
}

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(error) } })
}

function secretRequired(reply: FastifyReply) {
  return reply.status(409).send({
    error: {
      code: "secret_required",
      message: "This endpoint has no signing secret yet. Rotate its secret first (POST /v1/webhook-endpoints/{id}/rotate-secret).",
    },
  })
}

/** The account (or app) already has an endpoint on this address here. */
function urlTaken(reply: FastifyReply) {
  return reply.status(409).send({
    error: { code: "url_taken", message: "You already have a webhook endpoint for this address." },
  })
}

/** A stored address the rules no longer accept (an endpoint older than them): it must be changed first. */
function urlInvalid(reply: FastifyReply, issue: string) {
  return reply.status(409).send({
    error: {
      code: "url_invalid",
      message: `This endpoint's address is not accepted (${issue}). Change it first (PATCH /v1/webhook-endpoints/{id} with a new url).`,
    },
  })
}

/** The stored address, normalized — or the reason it is no longer accepted. */
function checkStoredUrl(url: string): { ok: true; url: string } | { ok: false; issue: string } {
  const result = webhookUrl.safeParse(url)
  if (result.success) return { ok: true, url: result.data }
  return { ok: false, issue: result.error.issues[0]?.message ?? "not a valid address" }
}

const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === "23505"

/**
 * A database error: 503 while the shared database does not have the feature
 * yet (staging runs before migrations reach it), else a sanitized 500. The
 * log gets the error's code or first line only (describeDbError): a
 * constraint violation's details quote the row, the address and the sealed
 * secret with it.
 */
function dbFailure(reply: FastifyReply, req: FastifyRequest, error: unknown, message: string) {
  const err = error as { code?: string | null } | null
  if (isMissingColumnError(err) || isMissingTableError(err) || isMissingFunctionError(error)) {
    return reply.status(503).send({
      error: { code: "not_available", message: "Webhook endpoints are not available on this server yet." },
    })
  }
  return sendInternalError(reply, req, new Error(`webhook endpoints: database error (${describeDbError(error)})`), message)
}

/** The sealed secret, or the 503 an install with no instance key answers. */
function sealOrRefuse(
  reply: FastifyReply,
  req: FastifyRequest,
  secret: string,
  binding: { endpointId: string; userId: string; runtimeEnv: string },
): string | null {
  try {
    return sealSigningSecret(secret, binding)
  } catch (err) {
    if (err instanceof EncryptionKeyMissingError) {
      // The operator's fix, verbatim: no user data in it.
      reply.status(503).send({ error: { code: "encryption_key_missing", message: err.message } })
      return null
    }
    sendInternalError(reply, req, err, "Failed to protect the signing secret")
    return null
  }
}

/** Parsed `:id` and the caller's own endpoint, or null after replying. */
async function ownEndpoint(
  req: FastifyRequest,
  reply: FastifyReply,
  failMessage: string,
): Promise<{ caller: EndpointCaller; row: EndpointRow } | null> {
  const caller = callerOf(req)
  if (!caller) {
    unauthorized(reply)
    return null
  }
  const params = idParams.safeParse(req.params)
  if (!params.success) {
    badRequest(reply, params.error)
    return null
  }
  const { data, error } = await findOwnEndpoint(caller, params.data.id)
  if (error) {
    dbFailure(reply, req, error, failMessage)
    return null
  }
  if (!data) {
    notFound(reply)
    return null
  }
  return { caller, row: data }
}

export async function webhookEndpointRoutes(app: FastifyInstance) {
  app.post("/v1/webhook-endpoints", { preHandler: scope, config: WRITE_LIMIT }, async (req, reply) => {
    const caller = callerOf(req)
    if (!caller) return unauthorized(reply)
    const parsed = createEndpointBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)

    // The id is chosen here: the sealed secret is bound to it.
    const id = randomUUID()
    const runtimeEnv = getRuntimeEnv()
    const secret = generateSigningSecret()
    const sealed = sealOrRefuse(reply, req, secret, { endpointId: id, userId: caller.userId, runtimeEnv })
    if (sealed === null) return reply

    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from("webhooks")
      .insert({
        id,
        user_id: caller.userId,
        url: parsed.data.url,
        events: parsed.data.events ?? [...WEBHOOK_JOB_EVENTS],
        description: parsed.data.description || null,
        is_active: true,
        runtime_env: runtimeEnv,
        app_id: caller.appId,
        secret_ciphertext: sealed,
        secret_created_at: now,
        updated_at: now,
      })
      .select(ENDPOINT_COLS)
      .single()
    if (error) {
      if ((error as { code?: string }).code === "53400") {
        return reply.status(400).send({
          error: { code: "limit_reached", message: `You can have at most ${MAX_ENDPOINTS_PER_ACCOUNT} webhook endpoints.` },
        })
      }
      if (isUniqueViolation(error)) return urlTaken(reply)
      return dbFailure(reply, req, error, "Failed to create the webhook endpoint")
    }
    // The one response that carries the secret: never kept by a cache.
    return reply.status(201).header("cache-control", "no-store").send({ data: toEndpointResponse(data as EndpointRow), secret })
  })

  app.get("/v1/webhook-endpoints", { preHandler: scope }, async (req, reply) => {
    const caller = callerOf(req)
    if (!caller) return unauthorized(reply)
    let query = supabase
      .from("webhooks")
      .select(ENDPOINT_COLS)
      .eq("user_id", caller.userId)
      .or(environmentFilter())
    if (caller.appId) query = query.eq("app_id", caller.appId)
    const { data, error } = await query.order("created_at", { ascending: false })
    if (error) return dbFailure(reply, req, error, "Failed to list webhook endpoints")
    return { data: ((data ?? []) as EndpointRow[]).map((row) => toEndpointResponse(row)) }
  })

  app.get("/v1/webhook-endpoints/:id", { preHandler: scope }, async (req, reply) => {
    const own = await ownEndpoint(req, reply, "Failed to fetch the webhook endpoint")
    if (!own) return reply
    return { data: toEndpointResponse(own.row) }
  })

  app.patch("/v1/webhook-endpoints/:id", { preHandler: scope, config: WRITE_LIMIT }, async (req, reply) => {
    if (!callerOf(req)) return unauthorized(reply)
    const body = updateEndpointBody.safeParse(req.body)
    if (!body.success) return badRequest(reply, body.error)
    const own = await ownEndpoint(req, reply, "Failed to update the webhook endpoint")
    if (!own) return reply
    const { caller, row } = own

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.data.url !== undefined) updates.url = body.data.url
    if (body.data.events !== undefined) updates.events = body.data.events
    if (body.data.description !== undefined) updates.description = body.data.description || null
    if (body.data.isActive === true) {
      if (!row.secret_created_at) return secretRequired(reply)
      // An address stored before today's rules (an endpoint older than them)
      // is checked again before anything is sent to it — and stored normalized.
      if (body.data.url === undefined) {
        const stored = checkStoredUrl(row.url)
        if (!stored.ok) return urlInvalid(reply, stored.issue)
        if (stored.url !== row.url) updates.url = stored.url
      }
      Object.assign(updates, { is_active: true, disabled_reason: null, disabled_at: null, consecutive_failures: 0 })
    } else if (body.data.isActive === false) {
      // The owner's choice: no platform reason.
      Object.assign(updates, { is_active: false, disabled_reason: null, disabled_at: null })
    }

    const { data, error } = await supabase
      .from("webhooks")
      .update(updates)
      .eq("id", row.id)
      .eq("user_id", caller.userId)
      .select(ENDPOINT_COLS)
      .single()
    if (error) {
      if (isUniqueViolation(error)) return urlTaken(reply)
      return dbFailure(reply, req, error, "Failed to update the webhook endpoint")
    }
    return { data: toEndpointResponse(data as EndpointRow) }
  })

  // Deletes the endpoint and its delivery log; what was waiting is not sent.
  app.delete("/v1/webhook-endpoints/:id", { preHandler: scope, config: WRITE_LIMIT }, async (req, reply) => {
    const own = await ownEndpoint(req, reply, "Failed to delete the webhook endpoint")
    if (!own) return reply
    const { error } = await supabase
      .from("webhooks")
      .delete()
      .eq("id", own.row.id)
      .eq("user_id", own.caller.userId)
    if (error) return dbFailure(reply, req, error, "Failed to delete the webhook endpoint")
    return { success: true }
  })

  // A new secret, signing every delivery from now on, retries included —
  // beside the one it replaces for `gracePeriodSeconds` (a day by default; 0
  // ends the old one at once), so the receiver can be switched over without a
  // gap. Returned here only.
  app.post("/v1/webhook-endpoints/:id/rotate-secret", { preHandler: scope, config: WRITE_LIMIT }, async (req, reply) => {
    if (!callerOf(req)) return unauthorized(reply)
    const body = rotateSecretBody.safeParse(req.body ?? {})
    if (!body.success) return badRequest(reply, body.error)
    const own = await ownEndpoint(req, reply, "Failed to rotate the signing secret")
    if (!own) return reply
    const { caller, row } = own
    // An endpoint older than signing has no environment yet: it takes this one.
    const runtimeEnv = getRuntimeEnv()
    const secret = generateSigningSecret()
    const sealed = sealOrRefuse(reply, req, secret, { endpointId: row.id, userId: caller.userId, runtimeEnv })
    if (sealed === null) return reply

    const grace = body.data.gracePeriodSeconds ?? DEFAULT_GRACE_SECONDS
    // The swap happens in the database (migration 521, rotate_webhook_secret):
    // the replaced ciphertext moves aside there, and no read here ever selects
    // a ciphertext. Only a secret this environment sealed is kept; an endpoint
    // older than signing has none.
    const { data, error } = await supabase.rpc("rotate_webhook_secret", {
      p_webhook_id: row.id,
      p_user_id: caller.userId,
      p_runtime_env: runtimeEnv,
      p_secret_ciphertext: sealed,
      p_previous_expires_at: grace > 0 ? new Date(Date.now() + grace * 1000).toISOString() : null,
    })
    if (error) {
      // An endpoint older than signing takes this environment here, and can
      // then share an address with one created in it since.
      if (isUniqueViolation(error)) return urlTaken(reply)
      return dbFailure(reply, req, error, "Failed to rotate the signing secret")
    }
    const previousSecretExpiresAt = typeof data === "string" ? data : null
    return reply.header("cache-control", "no-store").send({ secret, previousSecretExpiresAt })
  })

  // One delivery of the endpoint's log, by its id (the id `test` returns).
  app.get("/v1/webhook-endpoints/:id/deliveries/:deliveryId", { preHandler: scope }, async (req, reply) => {
    const caller = callerOf(req)
    if (!caller) return unauthorized(reply)
    const params = deliveryParams.safeParse(req.params)
    if (!params.success) return badRequest(reply, params.error)
    const own = await ownEndpoint(req, reply, "Failed to fetch the webhook delivery")
    if (!own) return reply
    const { data, error } = await supabase
      .from("webhook_deliveries")
      .select(DELIVERY_COLS)
      .eq("id", params.data.deliveryId)
      .eq("webhook_id", own.row.id)
      .eq("user_id", own.caller.userId)
      .maybeSingle()
    if (error) return dbFailure(reply, req, error, "Failed to fetch the webhook delivery")
    if (!data) {
      return reply.status(404).send({ error: { code: "not_found", message: "Webhook delivery not found" } })
    }
    const row = data as DeliveryRow
    // A child job's kept body is never shown (childJobIdsOf).
    let children: Set<string>
    try {
      children = await childJobIdsOf([row.job_id])
    } catch (err) {
      return dbFailure(reply, req, err, "Failed to fetch the webhook delivery")
    }
    return { data: toDeliveryResponse(row, row.job_id !== null && children.has(row.job_id)) }
  })

  // The delivery log: the endpoint's deliveries, newest first (kept 30 days).
  app.get("/v1/webhook-endpoints/:id/deliveries", { preHandler: scope }, async (req, reply) => {
    if (!callerOf(req)) return unauthorized(reply)
    const parsed = listDeliveriesQuery.safeParse(req.query)
    if (!parsed.success) return badRequest(reply, parsed.error)
    const { status, limit = DEFAULT_PAGE, cursor } = parsed.data
    const after = cursor ? decodeCursor(cursor) : null
    if (cursor && !after) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid cursor" } })
    }
    const own = await ownEndpoint(req, reply, "Failed to list webhook deliveries")
    if (!own) return reply

    let query = supabase
      .from("webhook_deliveries")
      .select(DELIVERY_COLS)
      .eq("webhook_id", own.row.id)
      .eq("user_id", own.caller.userId)
    if (status) query = query.eq("status", status)
    if (after) query = query.or(afterKeyset(after))
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit)
    if (error) return dbFailure(reply, req, error, "Failed to list webhook deliveries")
    const rows = (data ?? []) as DeliveryRow[]
    const last = rows[rows.length - 1]
    // A child job's kept body is never shown (childJobIdsOf).
    let children: Set<string>
    try {
      children = await childJobIdsOf(rows.map((r) => r.job_id))
    } catch (err) {
      return dbFailure(reply, req, err, "Failed to list webhook deliveries")
    }
    return {
      data: rows.map((r) => toDeliveryResponse(r, r.job_id !== null && children.has(r.job_id))),
      next: rows.length === limit && last ? encodeCursor({ at: last.created_at, id: last.id }) : null,
    }
  })

  // A `ping` the dispatcher sends within seconds, once — to an endpoint that
  // is switched off too, so a receiver can be checked before switching on.
  app.post("/v1/webhook-endpoints/:id/test", { preHandler: scope, config: TEST_LIMIT }, async (req, reply) => {
    const own = await ownEndpoint(req, reply, "Failed to send a test event")
    if (!own) return reply
    if (!own.row.secret_created_at) return secretRequired(reply)
    const stored = checkStoredUrl(own.row.url)
    if (!stored.ok) return urlInvalid(reply, stored.issue)
    const { data, error } = await supabase
      .from("webhook_deliveries")
      .insert({
        webhook_id: own.row.id,
        user_id: own.caller.userId,
        job_id: null,
        event: "ping",
        status: "pending",
        next_retry_at: new Date().toISOString(),
      })
      .select(DELIVERY_COLS)
      .single()
    if (error) return dbFailure(reply, req, error, "Failed to send a test event")
    return reply.status(202).send({ data: toDeliveryResponse(data as DeliveryRow) })
  })
}

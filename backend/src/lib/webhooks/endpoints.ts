/**
 * Webhook endpoints — the reads, shapes and cursors `routes/webhook-endpoints.ts`
 * shares. Migration 521 holds the design notes.
 *
 * Whose rows a caller reaches: the account's own (`user_id`), in THIS
 * environment (`runtime_env`; a row older than 521 has none and shows in
 * every environment until its secret is rotated), and — for a connected
 * app's token — only the endpoints that app registered (`app_id`). A miss is
 * a 404 for the caller.
 */
import type { FastifyRequest } from "fastify"
import { supabase } from "../supabase.js"
import { getRuntimeEnv } from "../runtime-env.js"
import type {
  WebhookDeliveryStatus,
  WebhookDisabledReason,
  WebhookEventType,
  WebhookJobEvent,
} from "./event-types.js"

/**
 * Endpoints per account, every environment counted. The database enforces
 * it (migration 521, `webhooks_enforce_cap`, SQLSTATE 53400); this states the
 * same number for the message. webhook-endpoints.test.ts holds the two together.
 */
export const MAX_ENDPOINTS_PER_ACCOUNT = 10

/** Never the ciphertext: no route read selects it. */
export const ENDPOINT_COLS =
  "id, user_id, url, description, events, is_active, app_id, runtime_env, consecutive_failures, disabled_reason, disabled_at, secret_created_at, previous_secret_expires_at, created_at, updated_at"

export const DELIVERY_COLS =
  "id, webhook_id, user_id, job_id, event, status, attempts, response_status, response_body, duration_ms, last_error, payload, created_at, last_attempt_at, next_retry_at, delivered_at"

export interface EndpointRow {
  id: string
  user_id: string
  url: string
  description: string | null
  events: WebhookJobEvent[]
  is_active: boolean
  app_id: string | null
  runtime_env: string | null
  consecutive_failures: number
  disabled_reason: WebhookDisabledReason | null
  disabled_at: string | null
  secret_created_at: string | null
  previous_secret_expires_at: string | null
  created_at: string
  updated_at: string
}

export interface DeliveryRow {
  id: string
  webhook_id: string
  user_id: string
  job_id: string | null
  event: WebhookEventType
  status: WebhookDeliveryStatus
  attempts: number
  response_status: number | null
  response_body: string | null
  duration_ms: number | null
  last_error: string | null
  payload: unknown
  created_at: string
  last_attempt_at: string | null
  next_retry_at: string | null
  delivered_at: string | null
}

/** Until when the secret a rotation replaced still signs; null when none does (none, or its grace is over). */
function graceEnd(at: string | null): string | null {
  return at !== null && Date.parse(at) > Date.now() ? at : null
}

export function toEndpointResponse(row: EndpointRow) {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    events: row.events,
    isActive: row.is_active,
    disabledReason: row.disabled_reason,
    disabledAt: row.disabled_at,
    consecutiveFailures: row.consecutive_failures,
    appId: row.app_id,
    secretCreatedAt: row.secret_created_at,
    previousSecretExpiresAt: graceEnd(row.previous_secret_expires_at ?? null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toDeliveryResponse(row: DeliveryRow) {
  return {
    id: row.id,
    webhookId: row.webhook_id,
    event: row.event,
    jobId: row.job_id,
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.response_status,
    responseBody: row.response_body,
    durationMs: row.duration_ms,
    error: row.last_error,
    requestBody: typeof row.payload === "string" ? row.payload : null,
    createdAt: row.created_at,
    lastAttemptAt: row.last_attempt_at,
    nextAttemptAt: row.status === "pending" ? row.next_retry_at : null,
    deliveredAt: row.delivered_at,
  }
}

/** The caller a row must belong to: the account, and the app when an app's token calls. */
export interface EndpointCaller {
  userId: string
  appId: string | null
}

export function callerOf(req: FastifyRequest): EndpointCaller | null {
  if (!req.userId) return null
  return { userId: req.userId, appId: req.appAuthorization?.appId ?? null }
}

/** PostgREST `or` filter: this environment's rows, and the pre-521 ones that have none. */
export function environmentFilter(env: string = getRuntimeEnv()): string {
  const quoted = `"${env.replace(/["\\]/g, (ch) => `\\${ch}`)}"`
  return `runtime_env.eq.${quoted},runtime_env.is.null`
}

/** The caller's own endpoint here, or null (a 404 for the caller). */
export async function findOwnEndpoint(
  caller: EndpointCaller,
  id: string,
): Promise<{ data: EndpointRow | null; error: unknown }> {
  let query = supabase
    .from("webhooks")
    .select(ENDPOINT_COLS)
    .eq("id", id)
    .eq("user_id", caller.userId)
    .or(environmentFilter())
  if (caller.appId) query = query.eq("app_id", caller.appId)
  const { data, error } = await query.maybeSingle()
  return { data: (data as EndpointRow | null) ?? null, error }
}

/* ---------------------------------------------------------------- cursors */

export interface Keyset {
  readonly at: string
  readonly id: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The timestamp shape Postgres hands back, and nothing else: the value goes
// into a PostgREST `or()` filter, where text in parentheses would be syntax.
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/

export function encodeCursor(k: Keyset): string {
  return Buffer.from(JSON.stringify([k.at, k.id]), "utf8").toString("base64url")
}

/** null for a cursor this server did not issue. */
export function decodeCursor(raw: string): Keyset | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [at, id] = parsed
    if (typeof at !== "string" || !TIMESTAMP_RE.test(at) || Number.isNaN(Date.parse(at))) return null
    if (typeof id !== "string" || !UUID_RE.test(id)) return null
    return { at, id }
  } catch {
    return null
  }
}

/** "Strictly after `k`" in a newest-first `(created_at DESC, id DESC)` order. */
export function afterKeyset(k: Keyset): string {
  return `created_at.lt."${k.at}",and(created_at.eq."${k.at}",id.lt."${k.id}")`
}

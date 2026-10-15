import type { NodaroClient } from "../client.js"
import type { Job } from "./jobs.js"

/** Events an endpoint can subscribe to. */
export type WebhookJobEvent = "job.completed" | "job.failed"

/** Every event a delivery can carry: the job events, and the test ping. */
export type WebhookEventType = WebhookJobEvent | "ping"

/** A delivery's lifecycle: waiting (or being sent), sent, or given up on. */
export type WebhookDeliveryStatus = "pending" | "delivered" | "failed"

/** An https address Nodaro POSTs your job events to. */
export interface WebhookEndpoint {
  id: string
  url: string
  description: string | null
  events: WebhookJobEvent[]
  isActive: boolean
  /**
   * Why the platform switched it off: `"consecutive_failures"` (50
   * deliveries in a row failed for good) or `"legacy_secret"` (it predates
   * signing; rotate its secret). `null` when it is on, or you switched it off.
   */
  disabledReason: "consecutive_failures" | "legacy_secret" | null
  disabledAt: string | null
  /** Deliveries in a row that failed for good. Reset by a success. */
  consecutiveFailures: number
  /**
   * The connected app that registered it — it then receives only the jobs
   * that app submitted itself. `null` = registered by the account.
   */
  appId: string | null
  /** When the current signing secret was issued; `null` = none yet. */
  secretCreatedAt: string | null
  /**
   * After a rotation: until when the secret it replaced still signs too (a
   * second `v1=` in `Nodaro-Signature`). `null` when only one secret signs.
   */
  previousSecretExpiresAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateWebhookEndpointInput {
  /** An https address on a public host. */
  url: string
  /** Default: both. */
  events?: WebhookJobEvent[]
  /** Up to 500 characters. */
  description?: string
}

export interface UpdateWebhookEndpointInput {
  url?: string
  events?: WebhookJobEvent[]
  /** `true` also clears an automatic switch-off and its failure count. */
  isActive?: boolean
  /** `null` clears it. */
  description?: string | null
}

/** `create()`'s answer: the endpoint and its signing secret — shown this once. */
export interface CreatedWebhookEndpoint {
  data: WebhookEndpoint
  /** `whsec_…`. Store it now: no other call returns it. */
  secret: string
}

export interface RotateWebhookSecretInput {
  /**
   * Seconds the replaced secret keeps signing beside the new one (0 – 604800),
   * so your receiver can switch over without a gap. Default a day; `0` ends
   * the old secret at once (one that leaked).
   */
  gracePeriodSeconds?: number
}

/** `rotateSecret()`'s answer — the secret is shown this once. */
export interface RotatedWebhookSecret {
  /** `whsec_…`. Store it now: no other call returns it. */
  secret: string
  /** Until when the replaced secret still signs; `null` when it stopped at once. */
  previousSecretExpiresAt: string | null
}

/** One event sent (or to be sent) to one endpoint, with its attempts. */
export interface WebhookDelivery {
  /** Also the event's `id` and the `Nodaro-Delivery` header: the same on every retry. */
  id: string
  webhookId: string
  event: WebhookEventType
  jobId: string | null
  status: WebhookDeliveryStatus
  attempts: number
  /** The receiver's last HTTP status; `null` when no answer came. */
  responseStatus: number | null
  /** The first 2 KB of the receiver's last answer. */
  responseBody: string | null
  durationMs: number | null
  /**
   * Why the last attempt failed (`http_<status>`, `timeout`, `blocked_address`,
   * `connection_refused`, …) or why the delivery ended without one
   * (`endpoint_disabled`, `app_revoked`, `job_deleted`, `attempts_exhausted`).
   * `signing_unavailable` / `job_unreadable`: a problem on Nodaro's side — the
   * delivery waits and is tried again, its attempts unspent.
   */
  error: string | null
  /** The exact body sent (retries send the same text); `null` before the first recorded attempt and once delivered. */
  requestBody: string | null
  createdAt: string
  lastAttemptAt: string | null
  /** When a pending delivery is due (while it is being sent: when that attempt times out). */
  nextAttemptAt: string | null
  deliveredAt: string | null
}

export interface ListWebhookDeliveriesParams {
  status?: WebhookDeliveryStatus
  /** Page size, 1–100 (server default 20). */
  limit?: number
  /** The previous page's `next`. */
  cursor?: string
}

export interface WebhookDeliveryPage {
  data: WebhookDelivery[]
  /** Pass back as `cursor` for the next page; `null` on the last one. */
  next: string | null
}

/** A job event as your endpoint receives it (verify it with `verifyWebhookSignature`). */
export interface JobWebhookEvent {
  /**
   * The delivery id: the same on every retry — de-duplicate on it (this one,
   * from the verified body; the `Nodaro-Delivery` header is not signed).
   */
  id: string
  type: WebhookJobEvent
  /** When the job reached this status. */
  createdAt: string
  data: {
    /** The job, in the same shape `jobs.get()` returns. */
    job: Job
    /** Present when the event would pass 64 KB: these fields were left out — read the whole job with `jobs.get()`. */
    omitted?: Array<"input_data" | "output_data">
  }
}

/** The event `test()` sends. */
export interface PingWebhookEvent {
  id: string
  type: "ping"
  createdAt: string
  data: { webhookId: string }
}

export type WebhookEvent = JobWebhookEvent | PingWebhookEvent

/**
 * Outbound webhooks: register an https endpoint and Nodaro POSTs it every
 * `job.completed` / `job.failed` of your account, signed with the endpoint's
 * own secret (check it with `verifyWebhookSignature`), retried with backoff,
 * every attempt kept in its delivery log. OAuth app tokens need `jobs:read`;
 * an endpoint an app registers receives only the jobs that app submitted.
 */
export class WebhooksResource {
  constructor(private client: NodaroClient) {}

  /** `POST /v1/webhook-endpoints` → the endpoint and its signing secret (shown this once). */
  create(input: CreateWebhookEndpointInput): Promise<CreatedWebhookEndpoint> {
    return this.client.request<CreatedWebhookEndpoint>("POST", "/v1/webhook-endpoints", { body: input })
  }

  /** `GET /v1/webhook-endpoints` → your endpoints, newest first. Never a secret. */
  list(): Promise<{ data: WebhookEndpoint[] }> {
    return this.client.request("GET", "/v1/webhook-endpoints")
  }

  /** `GET /v1/webhook-endpoints/:id`. */
  get(id: string): Promise<{ data: WebhookEndpoint }> {
    return this.client.request("GET", `/v1/webhook-endpoints/${encodeURIComponent(id)}`)
  }

  /** `PATCH /v1/webhook-endpoints/:id` → change the address, events, description; switch on or off. */
  update(id: string, input: UpdateWebhookEndpointInput): Promise<{ data: WebhookEndpoint }> {
    return this.client.request("PATCH", `/v1/webhook-endpoints/${encodeURIComponent(id)}`, { body: input })
  }

  /** `DELETE /v1/webhook-endpoints/:id` → the endpoint and its delivery log. */
  delete(id: string): Promise<{ success: true }> {
    return this.client.request("DELETE", `/v1/webhook-endpoints/${encodeURIComponent(id)}`)
  }

  /**
   * `POST /v1/webhook-endpoints/:id/rotate-secret` → a new signing secret,
   * shown this once. It signs every delivery from now on (retries included);
   * the one it replaces keeps signing beside it for `gracePeriodSeconds` (a
   * day by default), so update your receiver within that time.
   */
  rotateSecret(id: string, input: RotateWebhookSecretInput = {}): Promise<RotatedWebhookSecret> {
    return this.client.request<RotatedWebhookSecret>("POST", `/v1/webhook-endpoints/${encodeURIComponent(id)}/rotate-secret`, {
      body: input,
    })
  }

  /** `GET /v1/webhook-endpoints/:id/deliveries` → the delivery log, newest first (kept 30 days). */
  deliveries(id: string, params: ListWebhookDeliveriesParams = {}): Promise<WebhookDeliveryPage> {
    return this.client.request("GET", `/v1/webhook-endpoints/${encodeURIComponent(id)}/deliveries`, {
      query: { status: params.status, limit: params.limit, cursor: params.cursor },
    })
  }

  /** `GET /v1/webhook-endpoints/:id/deliveries/:deliveryId` → one delivery (`test()` returns its id). */
  getDelivery(id: string, deliveryId: string): Promise<{ data: WebhookDelivery }> {
    return this.client.request(
      "GET",
      `/v1/webhook-endpoints/${encodeURIComponent(id)}/deliveries/${encodeURIComponent(deliveryId)}`,
    )
  }

  /**
   * `POST /v1/webhook-endpoints/:id/test` → queue a `ping` (sent within
   * seconds, tried once — even to an endpoint that is switched off). Follow
   * it with `deliveries()`.
   */
  test(id: string): Promise<{ data: WebhookDelivery }> {
    return this.client.request("POST", `/v1/webhook-endpoints/${encodeURIComponent(id)}/test`)
  }
}

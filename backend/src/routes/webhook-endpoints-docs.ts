/** OpenAPI entries for `/v1/webhook-endpoints` (routes in `webhook-endpoints.ts`). */
import { z } from "zod"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { WEBHOOK_DELIVERY_STATUSES, WEBHOOK_JOB_EVENTS } from "../lib/webhooks/event-types.js"
import {
  createEndpointBody,
  deliveryParams,
  idParams,
  listDeliveriesQuery,
  rotateSecretBody,
  updateEndpointBody,
} from "../lib/webhooks/schemas.js"

const WebhookEndpoint = z.object({
  id: z.string().uuid(),
  url: z.string().describe("The https address deliveries are POSTed to."),
  description: z.string().nullable(),
  events: z.array(z.enum(WEBHOOK_JOB_EVENTS)),
  isActive: z.boolean(),
  disabledReason: z
    .enum(["consecutive_failures", "legacy_secret"])
    .nullable()
    .describe("Why the platform switched the endpoint off; null when it is on, or you switched it off."),
  disabledAt: z.string().nullable(),
  consecutiveFailures: z.number().int().describe("Deliveries in a row that failed for good (every retry used). At 50 the endpoint is switched off."),
  appId: z
    .string()
    .uuid()
    .nullable()
    .describe("The connected app that registered it; it then receives only the jobs that app submitted. Null = registered by the account."),
  secretCreatedAt: z.string().nullable().describe("When the current signing secret was issued."),
  previousSecretExpiresAt: z
    .string()
    .nullable()
    .describe("After a rotation: until when the secret it replaced still signs too (a second `v1=`). Null when only one secret signs."),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const WebhookDelivery = z.object({
  id: z.string().uuid().describe("Also the event's `id` and the `Nodaro-Delivery` header: the same across retries."),
  webhookId: z.string().uuid(),
  event: z.enum(["job.completed", "job.failed", "ping"]),
  jobId: z.string().uuid().nullable(),
  status: z.enum(WEBHOOK_DELIVERY_STATUSES),
  attempts: z.number().int(),
  responseStatus: z.number().int().nullable(),
  responseBody: z.string().nullable().describe("The first 2 KB of the receiver's last answer."),
  durationMs: z.number().int().nullable(),
  error: z.string().nullable().describe("Why the last attempt failed: `http_<status>`, `timeout`, `blocked_address`, …"),
  requestBody: z
    .string()
    .nullable()
    .describe("The exact body sent; retries send the same text. Null before the first recorded attempt and once delivered."),
  createdAt: z.string(),
  lastAttemptAt: z.string().nullable(),
  nextAttemptAt: z.string().nullable().describe("When a pending delivery is due (while it is being sent: when its attempt times out)."),
  deliveredAt: z.string().nullable(),
})

const security = [{ bearerAuth: [] }]
const unauthorized = { description: "Unauthorized" }
const forbidden = { description: "A connected app's token without `jobs:read`" }
const notFound = { description: "Not found (or not yours)" }
const unavailable = { description: "Not available on this server yet, or the server has no encryption key" }

openApiRegistry.registerPath({
  method: "post",
  path: "/v1/webhook-endpoints",
  description:
    "Register an https endpoint that receives `job.completed` and `job.failed` (both unless `events` says otherwise), signed with its own secret. The secret is in this response only — store it now. At most 10 endpoints per account.",
  security,
  request: { body: { content: { "application/json": { schema: createEndpointBody } } } },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: z.object({ data: WebhookEndpoint, secret: z.string().describe("`whsec_…`, shown once.") }) } },
    },
    400: { description: "Invalid body, or `limit_reached`" },
    401: unauthorized,
    403: forbidden,
    409: { description: "`url_taken`: you already have an endpoint for this address" },
    503: unavailable,
  },
})

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/webhook-endpoints",
  description: "Your webhook endpoints, newest first. Never includes a secret.",
  security,
  responses: {
    200: { description: "Your endpoints", content: { "application/json": { schema: z.object({ data: z.array(WebhookEndpoint) }) } } },
    401: unauthorized,
    403: forbidden,
  },
})

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/webhook-endpoints/{id}",
  description: "One webhook endpoint.",
  security,
  request: { params: idParams },
  responses: {
    200: { description: "The endpoint", content: { "application/json": { schema: z.object({ data: WebhookEndpoint }) } } },
    401: unauthorized,
    403: forbidden,
    404: notFound,
  },
})

openApiRegistry.registerPath({
  method: "patch",
  path: "/v1/webhook-endpoints/{id}",
  description:
    "Change the address, the events, the description, or switch the endpoint on or off. Switching on clears an automatic switch-off and its failure count.",
  security,
  request: { params: idParams, body: { content: { "application/json": { schema: updateEndpointBody } } } },
  responses: {
    200: { description: "The endpoint", content: { "application/json": { schema: z.object({ data: WebhookEndpoint }) } } },
    400: { description: "Invalid body" },
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: {
      description:
        "`secret_required`: the endpoint has no signing secret yet, rotate it first; `url_taken`: you already have an endpoint for this address; `url_invalid`: switching on an endpoint whose stored address is no longer accepted — change its url first",
    },
  },
})

openApiRegistry.registerPath({
  method: "delete",
  path: "/v1/webhook-endpoints/{id}",
  description: "Delete the endpoint and its delivery log. Deliveries waiting for it are not sent.",
  security,
  request: { params: idParams },
  responses: { 200: { description: "Deleted" }, 401: unauthorized, 403: forbidden, 404: notFound },
})

openApiRegistry.registerPath({
  method: "post",
  path: "/v1/webhook-endpoints/{id}/rotate-secret",
  description:
    "Replace the signing secret. The new one signs every delivery from now on (retries included) and is in this response only; the one it replaces keeps signing beside it (a second `v1=`) for `gracePeriodSeconds` — a day by default, 0 to end it at once.",
  security,
  request: { params: idParams, body: { required: false, content: { "application/json": { schema: rotateSecretBody } } } },
  responses: {
    200: {
      description: "The new secret",
      content: {
        "application/json": {
          schema: z.object({
            secret: z.string(),
            previousSecretExpiresAt: z.string().nullable().describe("Until when the replaced secret still signs; null when it stopped at once."),
          }),
        },
      },
    },
    400: { description: "Invalid body" },
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: { description: "`url_taken`: an endpoint older than signing takes this environment, where you already have one on its address" },
    503: unavailable,
  },
})

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/webhook-endpoints/{id}/deliveries",
  description: "The endpoint's delivery log, newest first (kept 30 days).",
  security,
  request: { params: idParams, query: listDeliveriesQuery },
  responses: {
    200: {
      description: "A page of deliveries",
      content: { "application/json": { schema: z.object({ data: z.array(WebhookDelivery), next: z.string().nullable() }) } },
    },
    400: { description: "Invalid query or cursor" },
    401: unauthorized,
    403: forbidden,
    404: notFound,
  },
})

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/webhook-endpoints/{id}/deliveries/{deliveryId}",
  description: "One delivery of the endpoint's log, by its id (the id `test` returns).",
  security,
  request: { params: deliveryParams },
  responses: {
    200: { description: "The delivery", content: { "application/json": { schema: z.object({ data: WebhookDelivery }) } } },
    400: { description: "An id that is not a uuid" },
    401: unauthorized,
    403: forbidden,
    404: notFound,
  },
})

openApiRegistry.registerPath({
  method: "post",
  path: "/v1/webhook-endpoints/{id}/test",
  description:
    "Queue a `ping` to the endpoint (switched off or not), sent within seconds and tried once. Follow it in the delivery log.",
  security,
  request: { params: idParams },
  responses: {
    202: { description: "Queued", content: { "application/json": { schema: z.object({ data: WebhookDelivery }) } } },
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: {
      description:
        "`secret_required`: the endpoint has no signing secret yet; `url_invalid`: its stored address is no longer accepted — change its url first",
    },
  },
})

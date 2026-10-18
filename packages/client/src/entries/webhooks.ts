/**
 * `@nodaro/sdk/webhooks` — webhook endpoints and deliveries (`client.webhooks`), and verifying a delivery's signature on the receiving side.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { WebhooksResource } from "../resources/webhooks.js"

export type {
  WebhookJobEvent,
  WebhookEventType,
  WebhookDeliveryStatus,
  WebhookEndpoint,
  CreateWebhookEndpointInput,
  UpdateWebhookEndpointInput,
  CreatedWebhookEndpoint,
  RotateWebhookSecretInput,
  RotatedWebhookSecret,
  WebhookDelivery,
  ListWebhookDeliveriesParams,
  WebhookDeliveryPage,
  JobWebhookEvent,
  PingWebhookEvent,
  WebhookEvent,
} from "../resources/webhooks.js"

// Verifying a delivery on the receiving side (Web Crypto; Node 20+, edge, browsers).
export { verifyWebhookSignature, WebhookSignatureError } from "../webhook-signature.js"

export type { VerifyWebhookSignatureOptions, WebhookSignatureErrorCode } from "../webhook-signature.js"

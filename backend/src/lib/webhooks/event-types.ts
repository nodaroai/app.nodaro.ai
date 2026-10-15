/**
 * The webhook vocabulary — one source for the routes' schemas, the
 * dispatcher and the docs' OpenAPI entries. Migration 521 holds the same two
 * job events in `webhooks_events_valid` and the three event names in
 * `webhook_deliveries_event_valid`.
 */

/** Events an endpoint can subscribe to. */
export const WEBHOOK_JOB_EVENTS = ["job.completed", "job.failed"] as const
export type WebhookJobEvent = (typeof WEBHOOK_JOB_EVENTS)[number]

/** Every event a delivery can carry: the job events, and the test ping. */
export type WebhookEventType = WebhookJobEvent | "ping"

/** A delivery's lifecycle: waiting or being sent, sent, or given up on. */
export const WEBHOOK_DELIVERY_STATUSES = ["pending", "delivered", "failed"] as const
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number]

/** Why the platform switched an endpoint off. */
export type WebhookDisabledReason = "consecutive_failures" | "legacy_secret"

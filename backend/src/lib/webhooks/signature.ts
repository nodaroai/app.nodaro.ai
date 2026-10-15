/**
 * How a webhook request is signed — the contract every receiver verifies.
 *
 *   Nodaro-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 *
 * The key is the endpoint's whole secret string (`whsec_…`) as UTF-8, the
 * message is the decimal timestamp, a dot, and the exact bytes of the body
 * sent. `@nodaro/sdk`'s `verifyWebhookSignature` checks the same thing with
 * Web Crypto; both sides are pinned to the same two vectors
 * (lib/webhooks/__tests__/signature.test.ts and the SDK's
 * webhook-signature.test.ts). A future scheme is a new `vN=` entry beside
 * `v1`, never a change to `v1`.
 *
 * During a rotation's grace the header carries one `v1=` per secret — the
 * new one first, then the one it replaced — and a receiver accepts the request
 * when any of them matches, so it can switch secrets without a gap.
 */
import { createHmac } from "node:crypto"
import type { WebhookEventType } from "./event-types.js"

export const USER_AGENT = "Nodaro-Webhooks/1"

/** Hex HMAC-SHA256 of `<unixSeconds>.<body>` under `secret`. */
export function signPayload(secret: string, unixSeconds: number, body: string): string {
  if (!Number.isSafeInteger(unixSeconds) || unixSeconds < 0) {
    throw new Error("a webhook signature's time is whole unix seconds")
  }
  return createHmac("sha256", secret).update(`${unixSeconds}.${body}`, "utf8").digest("hex")
}

/** The `Nodaro-Signature` header value: one `v1=` per secret, in the order given. */
export function signatureHeader(secrets: string | readonly string[], unixSeconds: number, body: string): string {
  const list = typeof secrets === "string" ? [secrets] : secrets
  if (list.length === 0) throw new Error("a webhook signature needs a secret")
  return [`t=${unixSeconds}`, ...list.map((secret) => `v1=${signPayload(secret, unixSeconds, body)}`)].join(",")
}

export interface WebhookHeaderInput {
  secret: string
  /** The secret a rotation replaced, while its grace lasts: it signs too. */
  previousSecret?: string | null
  unixSeconds: number
  body: string
  event: WebhookEventType
  deliveryId: string
  webhookId: string
  /** 1 for the first attempt. */
  attempt: number
}

/** Every header a webhook request carries. */
export function webhookHeaders(input: WebhookHeaderInput): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "Nodaro-Event": input.event,
    "Nodaro-Delivery": input.deliveryId,
    "Nodaro-Webhook": input.webhookId,
    "Nodaro-Attempt": String(input.attempt),
    "Nodaro-Signature": signatureHeader(
      input.previousSecret ? [input.secret, input.previousSecret] : [input.secret],
      input.unixSeconds,
      input.body,
    ),
  }
}

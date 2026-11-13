import { createHash } from "node:crypto"
import type Stripe from "stripe"
import type { FastifyBaseLogger } from "fastify"
import { config } from "../../../lib/config.js"
import { purchaseOfStripeEvent, type PurchaseFacts } from "./purchase-event.js"

/**
 * Settled Stripe payments, reported to the site's Google Analytics as GA4
 * `purchase` events through the Measurement Protocol — the browser that
 * started the checkout is long gone when Stripe confirms the payment.
 *
 * Inert unless GA4_MEASUREMENT_ID and GA4_API_SECRET are both set. Never part
 * of billing: the webhook calls it after its grants, does not wait for it, and
 * nothing it does (a slow or failed send, a Redis outage) can reach the
 * acknowledgement or a grant.
 *
 * Once per payment: the transaction id is claimed in Redis before the send, so
 * a redelivered or replayed event is not counted twice. A claim that fails, or
 * does not answer within two seconds (the queue connection holds commands
 * while Redis is away and never gives up), lets the send go ahead — a rare
 * double count over a lost purchase.
 */

const MP_ENDPOINT = "https://www.google-analytics.com/mp/collect"
const SEND_TIMEOUT_MS = 5_000
const CLAIM_TIMEOUT_MS = 2_000
/** Far past Stripe's redelivery window (three days). */
const CLAIM_TTL_SECONDS = 30 * 24 * 60 * 60
const MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/

export interface MeasurementConfig {
  readonly measurementId: string
  readonly apiSecret: string
}

export type ReportOutcome = "sent" | "skipped" | "duplicate" | "failed"

export interface ReportDeps {
  readonly config: () => MeasurementConfig | null
  /** True when this transaction had not been reported yet (and now counts as reported). */
  readonly claimOnce: (transactionId: string) => Promise<boolean>
  readonly send: (payload: MeasurementPayload, cfg: MeasurementConfig) => Promise<boolean>
}

export interface MeasurementPayload {
  readonly client_id: string
  readonly user_id?: string
  readonly events: ReadonlyArray<{ readonly name: "purchase"; readonly params: Readonly<Record<string, unknown>> }>
}

/** The Measurement Protocol settings, or null when reporting is off. */
export function measurementConfig(
  env: { readonly measurementId?: string; readonly apiSecret?: string } = {
    measurementId: config.GA4_MEASUREMENT_ID,
    apiSecret: config.GA4_API_SECRET,
  },
): MeasurementConfig | null {
  const measurementId = (env.measurementId ?? "").trim()
  const apiSecret = (env.apiSecret ?? "").trim()
  if (!MEASUREMENT_ID.test(measurementId) || !apiSecret) return null
  return { measurementId, apiSecret }
}

/** Stripe's smallest-unit amount in the currency's main unit. */
export function majorUnits(amountMinor: number, currency: string): number {
  if (ZERO_DECIMAL.has(currency)) return amountMinor
  if (THREE_DECIMAL.has(currency)) return amountMinor / 1000
  return amountMinor / 100
}

// Stripe's own lists (stripe.com/docs/currencies): amounts in whole units, and in thousandths.
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"])
const THREE_DECIMAL = new Set(["BHD", "JOD", "KWD", "OMR", "TND"])

/**
 * The GA4 request for a purchase. The client id is the visit's when the
 * checkout carried one; otherwise (a renewal of a subscription started before
 * visits were kept, an auto-recharge) a stand-in derived from the account, the
 * same for every such payment of that account. Null when there is neither.
 */
export function purchasePayload(facts: PurchaseFacts): MeasurementPayload | null {
  const clientId = facts.gaClientId ?? (facts.userId ? accountClientId(facts.userId) : null)
  if (!clientId) return null
  const value = majorUnits(facts.amountMinor, facts.currency)
  return {
    client_id: clientId,
    ...(facts.userId ? { user_id: facts.userId } : {}),
    events: [
      {
        name: "purchase",
        params: {
          transaction_id: facts.transactionId,
          value,
          currency: facts.currency,
          items: [
            {
              item_id: facts.item.id,
              item_name: facts.item.name,
              item_category: facts.item.category,
              ...(facts.item.variant ? { item_variant: facts.item.variant } : {}),
              price: value,
              quantity: 1,
            },
          ],
          ...(facts.gaSessionId ? { session_id: facts.gaSessionId } : {}),
          engagement_time_msec: 1,
        },
      },
    ],
  }
}

/** A stable stand-in client id for an account, in GA's own shape (two runs of digits). */
function accountClientId(userId: string): string {
  const digest = createHash("sha256").update(`nodaro-purchase:${userId}`).digest()
  return `${digest.readUInt32BE(0)}.${digest.readUInt32BE(4)}`
}

async function sendToMeasurementProtocol(payload: MeasurementPayload, cfg: MeasurementConfig): Promise<boolean> {
  const url = `${MP_ENDPOINT}?measurement_id=${encodeURIComponent(cfg.measurementId)}&api_secret=${encodeURIComponent(cfg.apiSecret)}`
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  })
  return res.ok
}

/** A claim's answer, or true (go ahead) when it fails or does not come within `ms`. */
export function claimOrProceed(claim: Promise<boolean>, ms: number = CLAIM_TIMEOUT_MS): Promise<boolean> {
  const proceed = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(true), ms)
    timer.unref?.()
  })
  return Promise.race([claim.catch(() => true), proceed])
}

async function claimInRedis(transactionId: string): Promise<boolean> {
  try {
    // Loaded here, not at the top: only a deployment that reports purchases
    // opens the queue connection from this module.
    const { redis } = await import("../../../lib/queue-connection.js")
    return await claimOrProceed(
      redis.set(`analytics:purchase:${transactionId}`, "1", "EX", CLAIM_TTL_SECONDS, "NX").then((set) => set === "OK"),
    )
  } catch {
    return true
  }
}

const defaultDeps: ReportDeps = {
  config: () => measurementConfig(),
  claimOnce: claimInRedis,
  send: sendToMeasurementProtocol,
}

/**
 * Report a Stripe event's payment, if it is one. Returns at once; never
 * throws and never rejects.
 */
export function reportStripePurchase(event: Stripe.Event, log?: FastifyBaseLogger, deps: ReportDeps = defaultDeps): void {
  void reportStripePurchaseNow(event, log, deps).catch(() => {})
}

/** The report itself, awaited (tests; the webhook goes through reportStripePurchase). */
export async function reportStripePurchaseNow(
  event: Stripe.Event,
  log?: FastifyBaseLogger,
  deps: ReportDeps = defaultDeps,
): Promise<ReportOutcome> {
  const cfg = deps.config()
  if (!cfg) return "skipped"
  let facts: PurchaseFacts | null
  try {
    facts = purchaseOfStripeEvent(event)
  } catch {
    return "skipped"
  }
  const payload = facts ? purchasePayload(facts) : null
  if (!facts || !payload) return "skipped"
  if (!(await deps.claimOnce(facts.transactionId))) return "duplicate"
  try {
    if (await deps.send(payload, cfg)) return "sent"
    log?.warn({ transactionId: facts.transactionId }, "[analytics] purchase not accepted by Google Analytics")
    return "failed"
  } catch (err) {
    log?.warn({ transactionId: facts.transactionId, err: (err as Error).message }, "[analytics] purchase not sent to Google Analytics")
    return "failed"
  }
}

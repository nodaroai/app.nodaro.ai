/**
 * When a webhook delivery is tried again, and when it is given up.
 *
 * Any answer other than a 2xx — a 3xx (redirects are not followed), a 4xx, a
 * 5xx, a timeout, a refused or unreachable address — fails the attempt. The
 * next one waits RETRY_DELAYS_MS[attempt - 1], spread by ±10% so many
 * deliveries that failed together do not all come back in the same second.
 * After MAX_ATTEMPTS the delivery fails for good. A test ping is tried once:
 * whoever sent it is looking at the result.
 */
import type { WebhookEventType } from "./event-types.js"

/** 30 s, 2 min, 10 min, 1 h, 6 h, 12 h, 24 h: about 43 hours in all. */
export const RETRY_DELAYS_MS = [
  30_000,
  120_000,
  600_000,
  3_600_000,
  21_600_000,
  43_200_000,
  86_400_000,
] as const

/** The first attempt plus one per delay. */
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1

/**
 * Deliveries in a row that fail for good before the endpoint is switched off
 * (`disabled_reason = 'consecutive_failures'`). Each such delivery has failed
 * for about 43 hours, so this is a long run, never a short outage. Passed to
 * `record_webhook_delivery_attempt` (migration 521).
 */
export const DISABLE_AFTER_FAILED_DELIVERIES = 50

/**
 * Attempts in a row with no HTTP answer at all (a timeout, a refused
 * connection, an address that is not public) after which the endpoint rests:
 * a minute, then twice as long after each further CIRCUIT_AFTER_NO_ANSWER, an
 * hour at most (migration 521, `record_webhook_delivery_attempt`; the claim
 * passes a resting endpoint over, its deliveries waiting with their attempts
 * unspent). Any HTTP answer closes the circuit.
 */
export const CIRCUIT_AFTER_NO_ANSWER = 5

/**
 * When an attempt could not be made for a reason on Nodaro's side (the job
 * could not be read, the secret could not be opened), the delivery is
 * deferred this long: the attempt is given back and nothing counts against
 * the endpoint.
 */
export const PLATFORM_RETRY_MS = 5 * 60_000

const JITTER = 0.1

export function attemptsFor(event: WebhookEventType): number {
  return event === "ping" ? 1 : MAX_ATTEMPTS
}

/**
 * How long to wait after failed attempt number `attempt` (1-based), or null
 * when that was the last one.
 */
export function nextRetryDelayMs(
  event: WebhookEventType,
  attempt: number,
  random: () => number = Math.random,
): number | null {
  if (attempt >= attemptsFor(event)) return null
  const base = RETRY_DELAYS_MS[attempt - 1]
  if (base === undefined) return null
  const spread = 1 - JITTER + 2 * JITTER * Math.min(Math.max(random(), 0), 1)
  return Math.round(base * spread)
}

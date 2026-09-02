import { config } from "../../lib/config.js"

/**
 * Minimal Loops (loops.so) contact client — the only outbound integration for
 * the marketing list. Cloud-only: `LOOPS_API_KEY` is empty on community/self-
 * host, and every call here no-ops when it is unset (never a mock, never a
 * throw — the same "feature gated behind a present key" shape as KIE/Stripe).
 *
 * Loops upserts contacts by email, so a single `updateContact` covers create,
 * update, subscribe and unsubscribe. We never store a Loops contact id; email
 * is the join key on both sides.
 */

const LOOPS_API_BASE = "https://app.loops.so/api/v1"
const REQUEST_TIMEOUT_MS = 10_000

export function isLoopsConfigured(): boolean {
  return config.LOOPS_API_KEY.trim().length > 0
}

export interface LoopsContactProperties {
  /** First name, if known. */
  firstName?: string
  /** Whether the contact receives marketing email. false = unsubscribed. */
  subscribed?: boolean
  /** Free-form custom properties (must already exist as Loops contact
   *  properties, or be created in the Loops dashboard). */
  [key: string]: string | number | boolean | undefined
}

export interface LoopsResult {
  ok: boolean
  status?: number
  error?: string
}

/**
 * Upsert a contact in Loops. Resolves `{ ok: false }` (never throws) on any
 * failure so the caller can mark the row for retry and move on — a Loops
 * outage must never break the consent write it mirrors.
 */
export async function updateContact(
  email: string,
  properties: LoopsContactProperties,
): Promise<LoopsResult> {
  if (!isLoopsConfigured()) {
    return { ok: false, error: "loops_not_configured" }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${LOOPS_API_BASE}/contacts/update`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${config.LOOPS_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, ...properties }),
      signal: controller.signal,
    })
    if (!res.ok) {
      // Read a short slice of the body for the log without holding a huge string.
      const detail = (await res.text().catch(() => "")).slice(0, 300)
      return { ok: false, status: res.status, error: detail || `http_${res.status}` }
    }
    return { ok: true, status: res.status }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "loops_request_failed"
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

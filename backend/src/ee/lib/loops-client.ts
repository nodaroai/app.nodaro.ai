import { config } from "../../lib/config.js"

/**
 * Minimal Loops (loops.so) client. Cloud-only: `LOOPS_API_KEY` is empty on
 * community/self-host, and every call here no-ops when it is unset (never a
 * mock, never a throw — the same "feature gated behind a present key" shape as
 * KIE/Stripe).
 *
 * Two surfaces, deliberately separate:
 *
 *  - `updateContact` — the MARKETING list. Loops upserts contacts by email, so
 *    one call covers create, update, subscribe and unsubscribe. We never store
 *    a Loops contact id; email is the join key on both sides.
 *
 *  - `sendTransactional` — a one-off SERVICE email to a single person
 *    (admin → user support messages). Transactional mail is not marketing:
 *    marketing consent does not gate it, and it must never be used for
 *    anything a reasonable recipient would read as promotion. Because of that
 *    it also must not quietly grow the marketing list, which is why
 *    `addToAudience` is pinned false on every send rather than left to the
 *    Loops default.
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
  /**
   * The customer's language: a `@nodaro/shared` LocaleId (`en`, `ja`, `pt-BR`…).
   * A CUSTOM property, so send it only once `languageProperty.ensure()`
   * (loops-contact-properties.ts) has confirmed it exists, and leave the key
   * out when the language is not known — what Loops does with an empty value
   * is not documented, so a null or a blank is never sent.
   */
  language?: string
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

// ---------------------------------------------------------------------------
// Contact lookup — the one READ. Loops is the only place an unsubscribe made
// from the link inside an email is recorded, so the daily pull in
// ee/notifications/loops-unsubscribe-pull.ts asks it, contact by contact.
// ---------------------------------------------------------------------------

export interface LoopsContactLookup extends LoopsResult {
  /** `null` when Loops has no contact for the email (deleted there, or never pushed). */
  contact: { email: string; subscribed: boolean } | null
}

/**
 * Look a contact up by email. `{ ok: true, contact: null }` means Loops knows
 * no such contact; `{ ok: false }` means we could not find out (key missing,
 * timeout, HTTP error) — the caller must treat that as "unknown", never as
 * "unsubscribed".
 */
export async function findContact(email: string): Promise<LoopsContactLookup> {
  if (!isLoopsConfigured()) return { ok: false, error: "loops_not_configured", contact: null }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${LOOPS_API_BASE}/contacts/find?email=${encodeURIComponent(email)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.LOOPS_API_KEY}` },
      signal: controller.signal,
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300)
      return { ok: false, status: res.status, error: detail || `http_${res.status}`, contact: null }
    }
    const body: unknown = await res.json().catch(() => null)
    if (!Array.isArray(body)) return { ok: false, status: res.status, error: "loops_unexpected_body", contact: null }
    const hit = body.find((c): c is { email?: unknown; subscribed?: unknown } => typeof c === "object" && c !== null)
    if (!hit) return { ok: true, status: res.status, contact: null }
    return {
      ok: true,
      status: res.status,
      contact: { email: typeof hit.email === "string" ? hit.email : email, subscribed: hit.subscribed === true },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "loops_request_failed"
    return { ok: false, error: msg, contact: null }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Custom contact properties — Loops accepts a value for a custom property only
// once the property exists in the account. What we write is made to exist first
// (loops-contact-properties.ts); these are the two calls that takes.
// ---------------------------------------------------------------------------

/** The custom property that carries a customer's language: a `@nodaro/shared` LocaleId. */
export const LOOPS_LANGUAGE_PROPERTY = "language"

export type LoopsPropertyType = "string" | "number" | "boolean" | "date"

export interface LoopsContactPropertyDef {
  key: string
  label: string
  type: string
}

export interface LoopsPropertyList extends LoopsResult {
  /** `null` unless Loops answered with a list — a failed read is never an empty account. */
  properties: LoopsContactPropertyDef[] | null
}

/** One call to the contact-properties endpoint. Never throws; a body that is not JSON comes back as `null`. */
async function callContactProperties(
  method: "GET" | "POST",
  query: string,
  body?: Record<string, unknown>,
): Promise<LoopsResult & { json: unknown }> {
  if (!isLoopsConfigured()) return { ok: false, error: "loops_not_configured", json: null }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${LOOPS_API_BASE}/contacts/properties${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.LOOPS_API_KEY}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const raw = await res.text().catch(() => "")
    if (!res.ok) return { ok: false, status: res.status, error: raw.slice(0, 300) || `http_${res.status}`, json: null }
    return { ok: true, status: res.status, json: parseJson(raw) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "loops_request_failed"
    return { ok: false, error: msg, json: null }
  } finally {
    clearTimeout(timer)
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * The account's CUSTOM contact properties. `{ ok: false }` means we could not
 * find out (key missing, timeout, HTTP error, a body that is not a list) — the
 * caller must treat that as "unknown", never as "the account has none".
 */
export async function listCustomContactProperties(): Promise<LoopsPropertyList> {
  const r = await callContactProperties("GET", "?list=custom")
  if (!r.ok) return { ok: false, status: r.status, error: r.error, properties: null }
  if (!Array.isArray(r.json)) return { ok: false, status: r.status, error: "loops_unexpected_body", properties: null }

  const properties = r.json.flatMap((entry): LoopsContactPropertyDef[] => {
    if (typeof entry !== "object" || entry === null) return []
    const { key, label, type } = entry as { key?: unknown; label?: unknown; type?: unknown }
    if (typeof key !== "string") return []
    return [{ key, label: typeof label === "string" ? label : key, type: typeof type === "string" ? type : "" }]
  })
  return { ok: true, status: r.status, properties }
}

/** Create a custom contact property. Resolves `{ ok: false }` (never throws), with Loops' own reason when it gave one. */
export async function createContactProperty(name: string, type: LoopsPropertyType): Promise<LoopsResult> {
  const r = await callContactProperties("POST", "", { name, type })
  if (!r.ok) return { ok: false, status: r.status, error: r.error }

  // An explicit `success: false` on a 2xx is still Loops saying no.
  const reply = typeof r.json === "object" && r.json !== null ? (r.json as { success?: unknown; message?: unknown }) : null
  if (reply?.success === false) {
    return { ok: false, status: r.status, error: typeof reply.message === "string" ? reply.message : "loops_reported_failure" }
  }
  return { ok: true, status: r.status }
}

// ---------------------------------------------------------------------------
// Transactional send
// ---------------------------------------------------------------------------

/** Flat, string-valued substitutions for a Loops transactional template. */
export type LoopsDataVariables = Readonly<Record<string, string>>

/**
 * WHY A FAILURE HAS A KIND.
 *
 * "The provider said no" and "we stopped waiting" are opposite facts, and
 * collapsing them is how a delivered email gets recorded as failed. Loops
 * accepting a message and taking 11 seconds to say so trips the 10s timeout;
 * treated as a rejection, the row reads `failed`, the admin is told the
 * provider refused it, and they send it again — the recipient gets two emails
 * and the log, which is the entire point of this feature, is wrong about both.
 *
 *  - `provider`  — Loops answered, and the answer was no. The message did not
 *                  go. Safe to record as failed and safe to retry.
 *  - `timeout` / `network` — we never learned the outcome. The message may well
 *                  have been delivered. The caller must NOT record this as a
 *                  failure and must not invite a retry.
 *  - `not_configured` — there is no provider on this deployment at all.
 */
export type LoopsFailureKind = "provider" | "timeout" | "network" | "not_configured"

export interface LoopsTransactionalResult extends LoopsResult {
  /** Loops' own id for the send, when the response carries one. */
  messageId?: string
  /** Present on failure only. See `LoopsFailureKind`. */
  failureKind?: LoopsFailureKind
}

/**
 * Send one transactional email.
 *
 * Resolves `{ ok: false }` rather than throwing on every failure — including a
 * missing API key — so the caller can record the outcome against its own row
 * and show the admin what happened. The RECORD of the attempt is ours; Loops
 * is only the pipe.
 *
 * `addToAudience: false` is explicit and load-bearing: a service email must not
 * enrol its recipient in the marketing list as a side effect.
 */
export async function sendTransactional(
  transactionalId: string,
  email: string,
  dataVariables: LoopsDataVariables,
): Promise<LoopsTransactionalResult> {
  if (!isLoopsConfigured()) {
    return { ok: false, error: "loops_not_configured", failureKind: "not_configured" }
  }

  const controller = new AbortController()
  // Tracked explicitly: `AbortError` is also what a caller-side abort produces,
  // and the distinction between "we timed out" and "the socket died" is the
  // difference between a delivered email and one that never left.
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${LOOPS_API_BASE}/transactional`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.LOOPS_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transactionalId,
        email,
        addToAudience: false,
        dataVariables,
      }),
      signal: controller.signal,
    })

    // Read the body once, then decide — a non-2xx carries the reason and a 2xx
    // may carry the id. Bounded: a provider is not trusted to be terse.
    const raw = (await res.text().catch(() => "")).slice(0, 1000)
    if (!res.ok) {
      // Loops answered. Whatever it says, the message did not go.
      return {
        ok: false,
        status: res.status,
        error: raw || `http_${res.status}`,
        failureKind: "provider",
      }
    }

    // The id is best-effort. Loops does not contractually promise one, and a
    // missing id must never turn a delivered email into a failed row.
    let messageId: string | undefined
    try {
      const body = JSON.parse(raw) as { id?: unknown; success?: unknown }
      if (typeof body.id === "string" && body.id.length > 0) messageId = body.id
      // An explicit `success: false` with a 200 is still the provider saying no.
      if (body.success === false) {
        return {
          ok: false,
          status: res.status,
          error: raw || "loops_reported_failure",
          failureKind: "provider",
        }
      }
    } catch {
      // Non-JSON 2xx: treat as sent, with no id.
    }

    return { ok: true, status: res.status, messageId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "loops_request_failed"
    // We never heard back. The message may have been delivered anyway — the
    // caller must treat this as unknown, not as a refusal.
    return { ok: false, error: msg, failureKind: timedOut ? "timeout" : "network" }
  } finally {
    clearTimeout(timer)
  }
}

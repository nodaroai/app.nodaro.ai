/**
 * Verifying a Nodaro webhook on the receiving side.
 *
 * Every delivery carries
 *
 *   Nodaro-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 *
 * where `secret` is the endpoint's whole signing secret (`whsec_…`, as
 * `client.webhooks.create()` / `rotateSecret()` returned it) used as the
 * UTF-8 key, and the message is the timestamp, a dot, and the exact body
 * bytes received. Pure Web Crypto (`crypto.subtle`): runs in Node 20+, Deno,
 * Bun, Cloudflare Workers, Vercel Edge and browsers. The comparison is
 * constant-time.
 */
import type { WebhookEvent } from "./resources/webhooks.js"

export type WebhookSignatureErrorCode =
  | "missing_secret"
  | "missing_header"
  | "malformed_header"
  | "signature_mismatch"
  | "timestamp_outside_tolerance"
  | "invalid_payload"
  | "crypto_unavailable"

/** Thrown by {@link verifyWebhookSignature}: refuse the request (a 400 is fine). */
export class WebhookSignatureError extends Error {
  readonly code: WebhookSignatureErrorCode

  constructor(code: WebhookSignatureErrorCode, message: string) {
    super(message)
    this.name = "WebhookSignatureError"
    this.code = code
  }
}

export interface VerifyWebhookSignatureOptions {
  /** The raw request body, exactly as received — not re-serialized JSON. */
  payload: string | Uint8Array | ArrayBuffer
  /** The `Nodaro-Signature` header (the first value, if it came more than once). */
  header: string | readonly string[] | null | undefined
  /** The endpoint's signing secret (`whsec_…`). */
  secret: string
  /**
   * Refuse a signature older or newer than this many seconds (replay
   * protection). Default 300. `0` turns the check off — not recommended.
   * Anything that is not a finite number ≥ 0 throws a `RangeError` rather
   * than quietly turning the check off.
   */
  toleranceSeconds?: number
}

const DEFAULT_TOLERANCE_SECONDS = 300
const HEX_SIGNATURE = /^[0-9a-f]{64}$/

function toBytes(payload: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof payload === "string") return new TextEncoder().encode(payload)
  if (payload instanceof Uint8Array) return payload
  return new Uint8Array(payload)
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** Compares every byte whatever it finds, so the time taken says nothing. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

function parseHeader(raw: string): { timestamp: number; signatures: string[] } {
  let timestamp: number | null = null
  const signatures: string[] = []
  for (const part of raw.split(",")) {
    const eq = part.indexOf("=")
    if (eq <= 0) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key === "t") {
      if (!/^\d{1,15}$/.test(value)) {
        throw new WebhookSignatureError("malformed_header", "Nodaro-Signature has no valid timestamp (t=)")
      }
      timestamp = Number(value)
    } else if (key === "v1") {
      signatures.push(value.toLowerCase())
    }
  }
  if (timestamp === null) throw new WebhookSignatureError("malformed_header", "Nodaro-Signature has no timestamp (t=)")
  if (signatures.length === 0) throw new WebhookSignatureError("malformed_header", "Nodaro-Signature has no v1 signature")
  return { timestamp, signatures }
}

/**
 * Check a webhook request's `Nodaro-Signature` and return its event.
 * Throws {@link WebhookSignatureError} (with a `code`) when it does not check out.
 *
 * Act on the event this returns — its `id` (to de-duplicate) and `type` (to
 * route) — never on the `Nodaro-Delivery` / `Nodaro-Event` headers: only the
 * timestamp and the body are signed. During a secret rotation's grace the
 * header carries a `v1=` for each secret; either matching is enough.
 *
 * ```ts
 * const event = await verifyWebhookSignature({
 *   payload: rawBody,
 *   header: request.headers.get("nodaro-signature"),
 *   secret: process.env.NODARO_WEBHOOK_SECRET!,
 * })
 * if (event.type === "job.completed") console.info(event.data.job.output_data)
 * ```
 */
export async function verifyWebhookSignature(options: VerifyWebhookSignatureOptions): Promise<WebhookEvent> {
  const { payload, secret } = options
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS
  if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0) {
    // A programming error, not a request to refuse: say so instead of
    // quietly accepting replays (NaN or a negative would skip the check).
    throw new RangeError("toleranceSeconds must be a finite number of seconds, 0 or more")
  }
  if (!secret) throw new WebhookSignatureError("missing_secret", "No signing secret was given")

  const header = typeof options.header === "string" ? options.header : options.header?.[0]
  if (!header || !header.trim()) throw new WebhookSignatureError("missing_header", "The request has no Nodaro-Signature header")
  const { timestamp, signatures } = parseHeader(header)

  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new WebhookSignatureError("crypto_unavailable", "Web Crypto (crypto.subtle) is not available in this runtime")

  const body = toBytes(payload)
  const prefix = new TextEncoder().encode(`${timestamp}.`)
  const message = new Uint8Array(prefix.length + body.length)
  message.set(prefix, 0)
  message.set(body, prefix.length)

  const key = await subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const expected = new Uint8Array(await subtle.sign("HMAC", key, message))

  let matched = false
  for (const candidate of signatures) {
    // A candidate that is not 64 hex characters cannot match; it is still
    // compared (as a zero buffer) so every candidate costs the same.
    const wellFormed = HEX_SIGNATURE.test(candidate)
    const bytes = wellFormed ? hexToBytes(candidate) : new Uint8Array(expected.length)
    if (constantTimeEqual(bytes, expected) && wellFormed) matched = true
  }
  if (!matched) throw new WebhookSignatureError("signature_mismatch", "The Nodaro-Signature does not match the body")

  if (tolerance > 0) {
    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - timestamp) > tolerance) {
      throw new WebhookSignatureError(
        "timestamp_outside_tolerance",
        `The signature's timestamp is more than ${tolerance} seconds from now`,
      )
    }
  }

  try {
    return JSON.parse(new TextDecoder().decode(body)) as WebhookEvent
  } catch {
    throw new WebhookSignatureError("invalid_payload", "The signed body is not JSON")
  }
}

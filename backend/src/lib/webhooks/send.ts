/**
 * One webhook POST. Never throws: every outcome is a SendResult the
 * dispatcher records.
 *
 * The address is the user's, so it goes through `safeFetch` — DNS is resolved
 * at connect time and a private, loopback, link-local or metadata address is
 * refused on every attempt, so a name that changes what it resolves to
 * (rebinding) cannot reach an internal host. Redirects are not followed: the
 * receiver answers at the registered address, or the attempt fails. This
 * install's own storage and its own public hosts are never a receiver.
 *
 * What is kept of an attempt is what a developer needs and nothing that can
 * leak: the status, at most 2 KB of the answer (read no further than that),
 * the duration, and a short fixed word for a transport failure — never the
 * raw error, which can name the internal address a host resolved to. A name
 * that resolves to a private address and a name that does not resolve at all
 * are the same word, `blocked_address`: two words would tell anyone with an
 * endpoint which internal host names exist.
 */
import { safeFetch } from "../safe-fetch.js"
import { isConfiguredStorageUrl } from "../own-storage-url.js"
import { isThisInstallAddress } from "./own-host.js"

export const SEND_TIMEOUT_MS = 10_000
export const RESPONSE_BODY_MAX = 2048

export interface SendResult {
  /** A 2xx answer: delivered. */
  ok: boolean
  /** The HTTP status, or null when no answer came. */
  status: number | null
  /** The start of the answer's body (≤ RESPONSE_BODY_MAX characters), or null. */
  body: string | null
  durationMs: number
  /** null when delivered; otherwise `http_<status>` or a transport word. */
  error: string | null
}

/** The words a failed attempt can carry, besides `http_<status>`. */
export type TransportError =
  | "timeout"
  /** Not a public internet address — or a name that does not resolve to one (refused before connecting). */
  | "blocked_address"
  | "not_https"
  | "connection_refused"
  | "connection_reset"
  | "tls_error"
  | "network_error"

/** The error and its causes, outermost first (fetch wraps what its connector threw). */
function errorChain(err: unknown): Error[] {
  const chain: Error[] = []
  let current: unknown = err
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    chain.push(current)
    current = (current as { cause?: unknown }).cause
  }
  return chain
}

function firstCode(chain: readonly Error[]): string | undefined {
  for (const e of chain) {
    const code = (e as { code?: unknown }).code
    if (typeof code === "string") return code
  }
  return undefined
}

/**
 * A transport failure as one fixed word. The whole cause chain is read:
 * fetch reports a refusal from safeFetch's DNS gate as `TypeError: fetch
 * failed`, with safeFetch's own message only on its `cause`.
 */
export function classifySendError(err: unknown): TransportError {
  const chain = errorChain(err)
  if (chain.length === 0) return "network_error"
  if (chain.some((e) => e.name === "TimeoutError" || e.name === "AbortError")) return "timeout"
  for (const e of chain) {
    if (
      e.message.startsWith("safeFetch: blocked") ||
      e.message.includes("private/reserved IP") ||
      e.message.startsWith("safeFetch: no DNS resolution") ||
      e.message.startsWith("safeFetch: DNS lookup failed")
    ) {
      return "blocked_address"
    }
  }
  const code = firstCode(chain)
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA") return "blocked_address"
  if (code === "ECONNREFUSED") return "connection_refused"
  if (code === "ECONNRESET" || code === "EPIPE" || code === "UND_ERR_SOCKET" || code === "UND_ERR_CLOSED") {
    return "connection_reset"
  }
  if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT" || code === "ETIMEDOUT") {
    return "timeout"
  }
  if (code && (code.startsWith("ERR_TLS") || code.includes("CERT") || code.includes("SIGNATURE") || code === "DEPTH_ZERO_SELF_SIGNED_CERT")) {
    return "tls_error"
  }
  return "network_error"
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/**
 * A receiver's answer as text the database can store: no NUL (Postgres text
 * cannot hold one, and the outcome could not be recorded at all — the
 * delivery would be sent again until its attempts ran out), no half of a
 * surrogate pair, and at most `max` characters, never cut inside a pair.
 */
export function storableText(text: string, max: number = RESPONSE_BODY_MAX): string {
  let out = text.replace(/\u0000/g, "").replace(LONE_SURROGATE, "�")
  if (out.length > max) {
    out = out.slice(0, max)
    if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1)
  }
  return out
}

/** At most RESPONSE_BODY_MAX characters of a body, reading no more than needed. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ""
  const decoder = new TextDecoder()
  let text = ""
  try {
    while (text.length < RESPONSE_BODY_MAX) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
  } catch {
    // An answer cut off mid-body still counts by its status.
  } finally {
    await reader.cancel().catch(() => {})
  }
  return storableText(text)
}

export async function postWebhook(url: string, body: string, headers: Record<string, string>): Promise<SendResult> {
  const started = Date.now()
  const fail = (error: TransportError): SendResult => ({ ok: false, status: null, body: null, durationMs: Date.now() - started, error })

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return fail("not_https")
  }
  if (parsed.protocol !== "https:") return fail("not_https")
  if (isConfiguredStorageUrl(parsed) || isThisInstallAddress(parsed)) return fail("blocked_address")

  try {
    const res = await safeFetch(url, {
      method: "POST",
      headers,
      body,
      timeoutMs: SEND_TIMEOUT_MS,
      followRedirects: false,
    })
    const text = await readCapped(res)
    const ok = res.status >= 200 && res.status < 300
    return {
      ok,
      status: res.status,
      body: text,
      durationMs: Date.now() - started,
      error: ok ? null : `http_${res.status}`,
    }
  } catch (err) {
    return fail(classifySendError(err))
  }
}

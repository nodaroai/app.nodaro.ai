/**
 * SSRF-safe fetch.
 *
 * Problem:
 *   `safeUrlSchema` in `./url-validator.ts` is a *syntactic* gate — it rejects
 *   literal `localhost`, loopback, and private-range IPs in the URL string.
 *   It cannot see the IP a hostname resolves to. An attacker-controlled
 *   hostname (`evil.example`) with an A-record pointing at `169.254.169.254`
 *   / `10.x` / `192.168.x.x` / etc. passes the schema. Once passed, routes
 *   like `save-to-storage` fetch the URL server-side and expose the response
 *   to the caller (uploaded to R2, streamed from `image-proxy`, fed to
 *   ffmpeg, etc.) — turning blind SSRF into a direct read-oracle for
 *   internal HTTP services.
 *
 * Fix:
 *   `safeFetch` performs DNS resolution at connection time inside a custom
 *   undici `Agent.connect.lookup`. Every resolved A/AAAA record is checked
 *   against the blocklist; a single private IP among the results fails the
 *   connection. Because the `lookup` runs per socket (including each
 *   redirect hop), DNS-rebinding attacks can't slip through a post-
 *   validation TOCTOU window. The fast-fail at the top of `safeFetch` also
 *   rejects literal private IPs in the URL before the agent is ever asked
 *   to connect.
 *
 * Usage:
 *   Wherever the server fetches a user-supplied URL (and especially where
 *   the response body is surfaced back to the user, written to storage, or
 *   piped into processing), use `safeFetch(url, init)` in place of global
 *   `fetch`. For fetches of URLs we *generated* (R2 public URLs, KIE job
 *   result URLs), global `fetch` is still fine.
 *
 * Layering:
 *   - `safeUrlSchema` (route boundary)  — syntactic gate, cheap.
 *   - `safeFetch`     (connection time) — DNS + IP gate, authoritative.
 *   Both are used together. The schema catches obvious attacks at the Zod
 *   boundary; safeFetch catches DNS-based attacks at request time.
 */
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici"
import { matchesCredentialBinding, type CredentialBinding } from "./credential-binding.js"
import { lookup as dnsLookup } from "node:dns"
import { isIP } from "node:net"
import { isConfiguredStorageUrl } from "./own-storage-url.js"
import { isPrivateOrReservedIP } from "@nodaro/shared"

const DEFAULT_TIMEOUT_MS = 30_000

export interface ResolvedAddress {
  address: string
  family: 4 | 6
}

// Moved to @nodaro/shared so the app runner's link card applies the same rule.
export { isPrivateOrReservedIP }

/**
 * Validate a DNS answer set and return the addresses undici may connect to.
 *
 * We fail closed if any answer is private/reserved, because a public hostname
 * that round-robins between public and private targets is still unsafe. When
 * no family is requested, IPv4 is ordered before IPv6 so dual-stack hosts
 * remain reachable on servers without IPv6 egress (Railway's default).
 *
 * Returns an **array** because undici's `connect.lookup` callback expects the
 * `net.lookup` `all: true` shape — `cb(null, addresses)`. Passing a single
 * `(address, family)` pair causes undici to read `address` off `undefined`
 * and throw `TypeError: Invalid IP address: undefined` before connecting
 * (reproduced on undici 6.25 against `scontent-*.cdninstagram.com`). The
 * pre-fix variant of this helper returned a single address and broke every
 * outbound `safeFetch` call on dual-stack upstreams.
 */
export function filterSafeResolvedAddresses(
  addrs: readonly ResolvedAddress[],
  requestedFamily?: 0 | 4 | 6,
): ResolvedAddress[] {
  if (!Array.isArray(addrs) || addrs.length === 0) {
    throw new Error("safeFetch: no DNS resolution")
  }

  for (const a of addrs) {
    if (isPrivateOrReservedIP(a.address)) {
      throw new Error(
        `safeFetch: refusing connection — DNS resolution includes private/reserved IP ${a.address}`,
      )
    }
  }

  if (requestedFamily === 4 || requestedFamily === 6) {
    const matches = addrs.filter((a) => a.family === requestedFamily)
    if (matches.length > 0) return matches
  }

  const v4 = addrs.filter((a) => a.family === 4)
  const v6 = addrs.filter((a) => a.family === 6)
  return v4.length > 0 ? [...v4, ...v6] : [...addrs]
}

/**
 * Pre-resolve `hostname` and report whether EVERY DNS answer is public.
 *
 * For server-side fetchers that do their own DNS+HTTP (yt-dlp) and therefore
 * never pass through `safeAgent`'s connect-time gate — callers reject the URL
 * up front instead of fetching it. Fail-closed: a lookup error counts as
 * not-public (such a host can't be downloaded anyway). Best-effort by nature —
 * TOCTOU/rebinding and redirect targets remain the external fetcher's exposure;
 * this closes the plain resolves-to-private case.
 */
export async function resolvesOnlyToPublicAddresses(hostname: string): Promise<boolean> {
  try {
    const addrs = await new Promise<ResolvedAddress[]>((resolve, reject) => {
      dnsLookup(hostname, { family: 0, all: true, verbatim: true }, (err, a) => {
        if (err) reject(err)
        else resolve(a as ResolvedAddress[])
      })
    })
    filterSafeResolvedAddresses(addrs) // throws on any private/reserved answer
    return true
  } catch {
    return false
  }
}

/**
 * Shared agent — a single instance across all safeFetch calls so the undici
 * connection pool is reused. The `connect.lookup` hook resolves the hostname
 * with `all: true` so multi-record answers are fully inspected; any private
 * IP among the results fails the connection before a socket is opened. This
 * gate does NOT fire for IP-literal hosts (Node skips options.lookup then), so
 * safeFetch validates redirect hops itself (see assertSafeRedirectTarget).
 */
/**
 * Plain agent for fetches inside the configured own-storage subtree (see
 * isConfiguredStorageUrl): no private-IP lookup gate — localhost/compose-
 * network addresses are the POINT there. Everything else keeps safeAgent.
 */
const ownStorageAgent = new Agent({})

const safeAgent = new Agent({
  connect: {
    lookup(hostname, options, cb) {
      dnsLookup(
        hostname,
        {
          family: (options.family as 0 | 4 | 6 | undefined) ?? 0,
          all: true,
          verbatim: true,
        },
        (err, addrs) => {
          if (err) {
            cb(err, "", 0)
            return
          }
          try {
            const filtered = filterSafeResolvedAddresses(
              addrs as ResolvedAddress[],
              (options.family as 0 | 4 | 6 | undefined) ?? 0,
            )
            // undici 6.x expects the `all:true` callback shape: an array of
            // `{ address, family }`. Passing a single `(address, family)`
            // triple causes `TypeError: Invalid IP address: undefined`.
            ;(cb as unknown as (err: NodeJS.ErrnoException | null, addrs: ResolvedAddress[]) => void)(null, filtered)
          } catch (lookupErr) {
            const wrapped =
              lookupErr instanceof Error
                ? new Error(lookupErr.message.replace("safeFetch: no DNS resolution", `safeFetch: no DNS resolution for ${hostname}`))
                : new Error(`safeFetch: DNS lookup failed for ${hostname}`)
            cb(wrapped, "", 0)
          }
        },
      )
    },
  },
})

export interface SafeFetchInit extends Omit<UndiciRequestInit, "dispatcher"> {
  /** Per-request abort timeout in ms. Applied in addition to `signal` if provided. Default 30s. */
  timeoutMs?: number
  /**
   * Credential headers for THIS request — a stored HTTP credential resolved
   * by `lib/http-credentials.ts`. Pass auth through HERE and never through
   * `headers`: the request is refused unless the first hop is https and (when
   * bound) inside the binding; on a redirect a bound credential is never
   * re-sent outside its binding (the request fails instead of following), and
   * a plain one is dropped — by its own header name, not only the fixed list
   * — once a hop leaves the initial origin. Own-storage targets are refused
   * outright: a webhook is never own storage.
   */
  credentialHeaders?: Record<string, string>
  /** Where `credentialHeaders` may travel (`bound_url` + `bound_match`). Absent = a plain credential. */
  credentialBinding?: CredentialBinding
}

/**
 * SSRF-safe replacement for global fetch. Callers should use this for any
 * fetch of a user-supplied URL whose response is surfaced (even indirectly)
 * back to the caller. See module docstring for rationale.
 *
 * Differences from global fetch:
 *   - Literal private/reserved IPs in the URL are rejected synchronously.
 *   - DNS is resolved at connection time; any resolved IP in the private /
 *     reserved / cloud-metadata ranges refuses the connection.
 *   - Redirects are followed MANUALLY (up to MAX_REDIRECTS): each hop's target
 *     is re-validated for protocol AND a private/reserved IP-literal host before
 *     it is followed. The agent's `lookup` gate covers DNS answers for hostname
 *     hops but is SKIPPED by Node for IP-literal hosts, so a redirect to
 *     `http://127.0.0.1/` would otherwise bypass every gate — the manual per-hop
 *     `assertSafeRedirectTarget` closes that.
 *   - Non-http(s) protocols are rejected.
 */
/** How many redirect hops safeFetch will follow before giving up. */
const MAX_REDIRECTS = 5

/**
 * Re-validate a REDIRECT target before following it: http(s) only, and a
 * literal private/reserved IP host is refused. This is load-bearing —
 * `safeAgent`'s `connect.lookup` gate validates DNS answers for HOSTNAME hops,
 * but Node's `net.connect` skips `options.lookup` when the host is already an IP
 * literal, so a `Location: http://127.0.0.1/` (or 169.254.169.254, ::1, 0.0.0.0)
 * would otherwise reach an internal target unchecked (SSRF). We follow redirects
 * manually so this runs on every hop. Never own-storage: a redirect off the
 * own-storage subtree is not own-storage.
 */
export function assertSafeRedirectTarget(rawUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    const shown = String(rawUrl ?? "").replace(/\s+/g, " ").trim().slice(0, 120)
    throw new Error(`safeFetch: blocked — redirect to an invalid URL: "${shown}"`)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`safeFetch: blocked — redirect to protocol ${parsed.protocol}`)
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "")
  if (isIP(hostname) && isPrivateOrReservedIP(hostname)) {
    throw new Error(`safeFetch: blocked — redirect to ${hostname} (private/reserved IP)`)
  }
}

/** Headers that must not survive a cross-origin redirect (matches undici's own
 *  RedirectHandler). No safeFetch caller sends these today; this keeps a future
 *  credentialed caller from silently leaking them to an attacker-controlled 302. */
const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"] as const

function stripCredentialHeaders(headers: SafeFetchInit["headers"], extraNames: readonly string[] = []): Headers {
  const out = new Headers(headers as HeadersInit)
  for (const h of CREDENTIAL_HEADERS) out.delete(h)
  for (const h of extraNames) out.delete(h)
  return out
}

/** The caller's headers with the credential headers laid over them (a credential wins a name clash). */
function withCredentialHeaders(headers: SafeFetchInit["headers"], credentialHeaders: Record<string, string>): Headers {
  const out = new Headers(headers as HeadersInit)
  for (const [name, value] of Object.entries(credentialHeaders)) out.set(name, value)
  return out
}

export async function safeFetch(url: string, init: SafeFetchInit = {}): Promise<Response> {
  // NAME what was rejected. `new URL()` throws a bare "Invalid URL" — no value,
  // no context — and that string is what reached /admin/app-reports as the
  // whole explanation of a failed merge (2026-09-04, merge-video-audio fed a
  // non-URL by a field mapping). Every other refusal in this function says what
  // it refused; so does this one now.
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    const shown = String(url ?? "").replace(/\s+/g, " ").trim().slice(0, 120)
    throw new Error(`safeFetch: not a valid URL: "${shown}"`)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`safeFetch: blocked — protocol ${parsed.protocol}`)
  }

  // Own-storage subtree (self-host MinIO behind the app origin): private-IP
  // gates don't apply — but redirects are refused, so the exemption cannot
  // be parlayed into a fetch of anything outside the subtree.
  const ownStorage = isConfiguredStorageUrl(parsed)

  // Fast-fail before opening a connection. The agent's lookup would also
  // catch this, but doing it here gives a clearer error message.
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "")
  if (!ownStorage && isIP(hostname) && isPrivateOrReservedIP(hostname)) {
    throw new Error(`safeFetch: blocked — ${hostname} is a private/reserved IP`)
  }

  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timer = AbortSignal.timeout(timeoutMs)
  const outer = init.signal
  const signal = outer ? AbortSignal.any([outer as AbortSignal, timer]) : timer

  // Drop our own options, and NEVER let a caller override redirect handling —
  // safe redirect following is the whole point of this function. The credential
  // lane is destructured too: it must not reach undici as an unknown option.
  const { timeoutMs: _t, redirect: _r, credentialHeaders, credentialBinding, ...forward } = init

  // The credential lane's first-hop rules — before any connection is opened.
  const credentialNames = credentialHeaders ? Object.keys(credentialHeaders) : []
  const credentialed = credentialNames.length > 0
  if (credentialed) {
    if (ownStorage) {
      throw new Error("safeFetch: blocked — a credential is never sent to this install's own storage")
    }
    if (parsed.protocol !== "https:") {
      throw new Error("safeFetch: blocked — a credential is only sent over https")
    }
    if (credentialBinding && !matchesCredentialBinding(url, credentialBinding)) {
      throw new Error("safeFetch: blocked — the destination is outside the address this credential is locked to")
    }
  }

  // Own-storage refuses redirects outright; the subtree exemption can't be
  // parlayed into a fetch off the subtree.
  if (ownStorage) {
    const response = await undiciFetch(url, {
      ...forward,
      redirect: "error" as const,
      signal,
      dispatcher: ownStorageAgent,
    })
    return response as unknown as Response
  }

  // General fetch: follow redirects MANUALLY so every hop is re-validated
  // (the agent's lookup gate never sees an IP-literal hop — see
  // assertSafeRedirectTarget). Verified: undici's redirect:"manual" returns the
  // real 3xx response with a readable Location header (it does NOT opaque it).
  const initialOrigin = parsed.origin
  let hopHeaders: SafeFetchInit["headers"] = credentialed
    ? withCredentialHeaders(forward.headers, credentialHeaders!)
    : forward.headers
  let credentialsStripped = false
  let currentUrl = url
  for (let hop = 0; ; hop++) {
    if (hop > MAX_REDIRECTS) {
      throw new Error(`safeFetch: blocked — more than ${MAX_REDIRECTS} redirects`)
    }
    if (hop > 0) assertSafeRedirectTarget(currentUrl)
    const response = await undiciFetch(currentUrl, {
      ...forward,
      headers: hopHeaders,
      redirect: "manual" as const,
      signal,
      dispatcher: safeAgent,
    })
    const location = response.headers.get("location")
    if (response.status >= 300 && response.status < 400 && location) {
      // Free the socket before the next hop; a redirect body is never surfaced.
      await (response.body as ReadableStream | null)?.cancel().catch(() => {})
      const next = new URL(location, currentUrl)
      // A BOUND credential is never re-sent outside its binding: the request
      // fails here rather than following bare (plan D6, "never a bare
      // unauthenticated POST" applied to hop 2).
      if (credentialed && credentialBinding && !credentialsStripped && !matchesCredentialBinding(next.toString(), credentialBinding)) {
        throw new Error("safeFetch: blocked — a redirect left the address this credential is locked to")
      }
      // Drop credential headers — the fixed list AND the credential's own
      // header name — once a hop leaves the initial origin. Runs whether or
      // not the caller passed `headers` of its own.
      if (!credentialsStripped && hopHeaders && next.origin !== initialOrigin) {
        hopHeaders = stripCredentialHeaders(hopHeaders, credentialNames)
        credentialsStripped = true
      }
      currentUrl = next.toString()
      continue
    }
    // undici's Response is a structural superset of the global one — the cast
    // keeps callers typed against globalThis.Response without pulling undici's
    // types into their signatures.
    return response as unknown as Response
  }
}

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
import { lookup as dnsLookup } from "node:dns"
import { isIP } from "node:net"

const DEFAULT_TIMEOUT_MS = 30_000

export interface ResolvedAddress {
  address: string
  family: 4 | 6
}

/**
 * True if the IP belongs to a range we refuse to connect to from server-side
 * fetches. Covers IPv4 loopback/private/link-local/cloud-metadata/multicast
 * and the equivalent IPv6 classes (including IPv4-mapped IPv6 embeddings).
 */
export function isPrivateOrReservedIP(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    if (a === 0) return true                             // 0.0.0.0/8 "this network"
    if (a === 127) return true                           // 127.0.0.0/8 loopback
    if (a === 10) return true                            // 10.0.0.0/8 private
    if (a === 172 && b >= 16 && b <= 31) return true     // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true              // 192.168.0.0/16 private
    if (a === 169 && b === 254) return true              // 169.254.0.0/16 link-local + AWS/GCP metadata
    if (a === 100 && b >= 64 && b <= 127) return true    // 100.64.0.0/10 CGN
    if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 benchmarking
    if (a >= 224) return true                            // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255
    return false
  }
  // IPv6. Hostnames from URL parsing come without brackets.
  const lower = ip.toLowerCase()
  if (lower === "::" || lower === "::1") return true    // unspecified / loopback
  if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return true // link-local fe80::/10
  if (/^f[cd]/.test(lower)) return true                 // unique-local fc00::/7
  if (lower.startsWith("ff")) return true               // multicast ff00::/8
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped IPv6. WHATWG URL parsing normalises the dotted-quad tail
    // into two hex quads (`::ffff:127.0.0.1` → `::ffff:7f00:1`), so handle
    // both forms.
    const tail = lower.slice(7)
    if (tail.includes(".")) {
      return isPrivateOrReservedIP(tail)
    }
    const parts = tail.split(":")
    if (parts.length === 2) {
      const hi = parseInt(parts[0] || "0", 16)
      const lo = parseInt(parts[1] || "0", 16)
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
        return isPrivateOrReservedIP(ipv4)
      }
    }
    // Unrecognisable mapped form — fail closed, treat as reserved.
    return true
  }
  if (lower.startsWith("::") && /^::[0-9a-f]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(lower)) {
    // IPv4-compatible IPv6 (deprecated but still defined).
    return isPrivateOrReservedIP(lower.replace(/^::/, ""))
  }
  return false
}

/**
 * Validate a DNS answer set and choose the address to connect to.
 *
 * We fail closed if any answer is private/reserved, because a public hostname
 * that round-robins between public and private targets is still unsafe. When
 * no family is requested, prefer IPv4 over IPv6 so dual-stack hosts remain
 * reachable on servers without IPv6 egress.
 */
export function selectSafeResolvedAddress(
  addrs: readonly ResolvedAddress[],
  requestedFamily?: 0 | 4 | 6,
): ResolvedAddress {
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
    const match = addrs.find((a) => a.family === requestedFamily)
    if (match) return match
  }

  return addrs.find((a) => a.family === 4) ?? addrs[0]!
}

/**
 * Shared agent — a single instance across all safeFetch calls so the undici
 * connection pool is reused. The `connect.lookup` hook resolves the hostname
 * with `all: true` so multi-record answers are fully inspected; any private
 * IP among the results fails the connection before a socket is opened.
 * Redirects flow through the same agent, so each hop is re-validated.
 */
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
            const selected = selectSafeResolvedAddress(
              addrs as ResolvedAddress[],
              (options.family as 0 | 4 | 6 | undefined) ?? 0,
            )
            cb(null, selected.address, selected.family)
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
 *   - Redirects are followed (fetch's default) but each hop is revalidated
 *     because the agent's `lookup` fires for every new socket.
 *   - Non-http(s) protocols are rejected.
 */
export async function safeFetch(url: string, init: SafeFetchInit = {}): Promise<Response> {
  const parsed = new URL(url)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`safeFetch: blocked — protocol ${parsed.protocol}`)
  }

  // Fast-fail before opening a connection. The agent's lookup would also
  // catch this, but doing it here gives a clearer error message.
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "")
  if (isIP(hostname) && isPrivateOrReservedIP(hostname)) {
    throw new Error(`safeFetch: blocked — ${hostname} is a private/reserved IP`)
  }

  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timer = AbortSignal.timeout(timeoutMs)
  const outer = init.signal
  const signal = outer ? AbortSignal.any([outer as AbortSignal, timer]) : timer

  // Drop our own option before forwarding.
  const { timeoutMs: _, ...forward } = init

  const response = await undiciFetch(url, {
    ...forward,
    signal,
    dispatcher: safeAgent,
  })
  // undici's Response is a structural superset of the global one — the cast
  // keeps callers typed against globalThis.Response without pulling undici's
  // types into their signatures.
  return response as unknown as Response
}

/**
 * Who is on the other end of this request — the ONE derivation.
 *
 * Every reader of a client address goes through here (rate-limit keys, the
 * free-grant signals, billing-key source restrictions, gallery-report dedup);
 * `__tests__/client-address-totality.test.ts` fails the build on a forwarding
 * header read anywhere else.
 *
 * HOW THE ADDRESS IS DECIDED
 *
 * 1. The nearest untrusted hop. Walk `X-Forwarded-For` plus the socket address
 *    from the right and skip our own infrastructure (loopback, RFC 1918,
 *    link-local, unique-local). Behind the bundled Caddy there is exactly one
 *    entry — the address Caddy decided — so this is the value every reader
 *    used before. When every hop is internal (a LAN or compose self-host), the
 *    leftmost entry is the answer, as it always was.
 *
 * 2. A platform edge that states the client. Configured, never inferred here:
 *    `CLIENT_IP_HEADER` names the header and `CLIENT_IP_HEADER_FROM` the hop
 *    ranges it is trusted from (required with a header; `any` is the explicit
 *    "from every hop", refused at boot otherwise). On Railway the container
 *    entrypoint sets `x-real-ip` from `100.64.0.0/10`: Railway's edge proxies
 *    connect from that range, Caddy does not trust it (so step 1 yields the
 *    proxy, ~22 shared addresses for every user of the platform), and Railway
 *    states the true client — Cloudflare-aware — in `X-Real-IP`. Detection
 *    lives in the entrypoint because the backend test runners are themselves
 *    hosted on Railway and inherit its variables.
 *
 *    A configured edge that sends no usable value — missing, malformed, not a
 *    public address, or a Cloudflare server — yields UNKNOWN, never the proxy:
 *    a proxy address shared by every user is the failure this module exists to
 *    end. Readers decide what unknown means for them (`networkKeyOrHop`).
 *
 * 3. Otherwise the hop from step 1.
 *
 * Read at CALL time (like `runtime-env.ts`): tests vary the variables per case.
 * The parsed range list and the HMAC key are memoised by their raw value.
 */

import { createHash, createHmac } from "node:crypto"
import {
  canonicalAddress,
  compileCidrList,
  isCloudflareEdgeAddress,
  isInternalHop,
  networkKey,
  type CidrMatcher,
} from "./ip-address.js"
import { isPrivateOrReservedIP } from "./safe-fetch.js"

export interface AddressedRequest {
  headers: Record<string, string | string[] | undefined>
  ip?: string
  socket?: { remoteAddress?: string | undefined } | null
}

export type ClientAddressSource = "edge-header" | "hop" | "unknown"

export interface ClientAddressDetail {
  /** The client, canonical; null when it cannot be known. */
  address: string | null
  source: ClientAddressSource
  /** The nearest untrusted hop (step 1), canonical. */
  hop: string | null
  /** The configured edge header, when one is configured. */
  header: string | null
  /**
   * Unknown BECAUSE the address is a Cloudflare server (stated by the edge, or
   * the hop itself). A caller can route through Cloudflare on purpose, so this
   * is a state an attacker can choose — readers that fail open on "unknown"
   * must not fail open on this one (`clientNetworkHash`).
   */
  cloudflare: boolean
}

function headerValue(req: AddressedRequest, name: string): string | undefined {
  const v = req.headers[name]
  if (Array.isArray(v)) return v.join(", ")
  return v
}

function socketAddress(req: AddressedRequest): string | null {
  return canonicalAddress(req.socket?.remoteAddress ?? req.ip ?? null)
}

/** Step 1. */
function nearestUntrustedHop(req: AddressedRequest): string | null {
  const xff = headerValue(req, "x-forwarded-for")
  const chain = (typeof xff === "string" ? xff.split(",") : [])
    .map((entry) => canonicalAddress(entry))
    .filter((entry): entry is string => entry !== null)
  const socket = socketAddress(req)
  if (socket) chain.push(socket)
  for (let i = chain.length - 1; i >= 0; i--) {
    const entry = chain[i]!
    if (!isInternalHop(entry)) return entry
  }
  return chain[0] ?? null
}

let edgeRangesCache: { raw: string; matcher: CidrMatcher } | null = null

function edgeRanges(raw: string): CidrMatcher {
  if (edgeRangesCache?.raw !== raw) {
    edgeRangesCache = { raw, matcher: compileCidrList(raw.split(",").map((s) => s.trim()).filter(Boolean)) }
  }
  return edgeRangesCache.matcher
}

/** The configured edge header; empty, `none` and `off` all mean "no edge". */
function configuredEdgeHeader(): string | null {
  const raw = process.env.CLIENT_IP_HEADER?.trim().toLowerCase() ?? ""
  return raw === "" || raw === "none" || raw === "off" ? null : raw
}

/**
 * Where the edge header is trusted from. A configured header with no range is a
 * boot error (`assertClientAddressConfig`): "trust it from anyone" must be the
 * explicit `any`, because behind the bundled Caddy a client's own X-Real-IP
 * arrives untouched.
 */
function edgeTrustedFromHop(hop: string | null): boolean {
  const fromRaw = process.env.CLIENT_IP_HEADER_FROM?.trim() ?? ""
  if (fromRaw.toLowerCase() === "any") return true
  return hop !== null && fromRaw.length > 0 && edgeRanges(fromRaw).matches(hop)
}

export function resolveClientAddress(req: AddressedRequest): ClientAddressDetail {
  const hop = nearestUntrustedHop(req)
  const header = configuredEdgeHeader()
  const unknown = (cloudflare: boolean): ClientAddressDetail => ({ address: null, source: "unknown", hop, header, cloudflare })
  if (header && edgeTrustedFromHop(hop)) {
    const stated = canonicalAddress(headerValue(req, header))
    if (!stated || isPrivateOrReservedIP(stated)) return unknown(false)
    if (isCloudflareEdgeAddress(stated)) return unknown(true)
    return { address: stated, source: "edge-header", hop, header, cloudflare: false }
  }
  if (hop && isCloudflareEdgeAddress(hop)) return unknown(true)
  return { address: hop, source: hop ? "hop" : "unknown", hop, header, cloudflare: false }
}

/** The client address, or null when it cannot be known. */
export function clientAddress(req: AddressedRequest): string | null {
  return resolveClientAddress(req).address
}

/** The client's network (IPv4 address / IPv6 /64), or null when unknown. */
export function clientNetworkKey(req: AddressedRequest): string | null {
  const address = clientAddress(req)
  return address ? networkKey(address) : null
}

/**
 * A rate-limit identity: the client's network, else the hop, else "unknown".
 * A limiter must never become WORSE than it was when the address is unknown,
 * and the hop is what every limiter keyed on before.
 */
export function rateLimitAddressKey(req: AddressedRequest): string {
  const detail = resolveClientAddress(req)
  if (detail.address) return networkKey(detail.address) ?? detail.address
  return detail.hop ?? "unknown"
}

// ---------------------------------------------------------------------------
// Hashing — an address is personal data, and these hashes outlive requests.
// ---------------------------------------------------------------------------

const MIN_SECRET_CHARS = 32
let hmacCache: { raw: string; key: Buffer } | null = null

/** Surrounding whitespace is not key material: a value of spaces is no secret. */
function secretText(): string {
  return (process.env.NETWORK_HASH_SECRET ?? "").trim()
}

function hashSecret(): Buffer | null {
  const raw = secretText()
  if (raw.length < MIN_SECRET_CHARS) return null
  if (hmacCache?.raw !== raw) hmacCache = { raw, key: Buffer.from(raw, "utf8") }
  return hmacCache.key
}

/**
 * The stored form of a network key. With `NETWORK_HASH_SECRET` (≥ 32 chars) an
 * HMAC — a dump of the table cannot be walked back to addresses, which an
 * unsalted sha256 of a 2^32 space can. Without it, plain sha256: the self-host
 * default and the scheme `signup_signals.ip_hash` has always used.
 *
 * Staging and production share one database, so they must hold the SAME secret,
 * and it must never be rotated: a new key starts a new hash space, which
 * forgets every recorded network.
 */
export function networkHash(key: string): string {
  const secret = hashSecret()
  if (secret) return createHmac("sha256", secret).update(key).digest("hex")
  return createHash("sha256").update(key).digest("hex")
}

/** For the boot log: which scheme, and a fingerprint that changes with the key. */
export function networkHashScheme(): { scheme: "hmac" | "sha256"; fingerprint: string | null; misconfigured: boolean } {
  const raw = process.env.NETWORK_HASH_SECRET ?? ""
  const secret = hashSecret()
  if (!secret) return { scheme: "sha256", fingerprint: null, misconfigured: raw.length > 0 }
  const fingerprint = createHmac("sha256", secret).update("nodaro:network-hash-fingerprint").digest("hex").slice(0, 8)
  return { scheme: "hmac", fingerprint, misconfigured: false }
}

/**
 * Refuse to start on a configuration that would silently fall back or silently
 * widen:
 * - a secret too short to use (this process would hash with sha256 and split
 *   the hash space from every replica that has the right secret);
 * - an edge header with no range to trust it from (behind the bundled Caddy a
 *   client's own X-Real-IP arrives untouched — "from anyone" must be the
 *   explicit `any`);
 * - a range list nothing in which parses (the header would never be trusted —
 *   the proxy-as-client failure this module exists to end).
 */
export function assertClientAddressConfig(): void {
  if (networkHashScheme().misconfigured) {
    throw new Error(`NETWORK_HASH_SECRET is set but shorter than ${MIN_SECRET_CHARS} characters`)
  }
  const fromRaw = process.env.CLIENT_IP_HEADER_FROM?.trim() ?? ""
  if (configuredEdgeHeader() && fromRaw.length === 0) {
    throw new Error("CLIENT_IP_HEADER is set without CLIENT_IP_HEADER_FROM (use 'any' to trust it from every hop)")
  }
  if (fromRaw.length > 0 && fromRaw.toLowerCase() !== "any" && edgeRanges(fromRaw).size === 0) {
    throw new Error("CLIENT_IP_HEADER_FROM is set but holds no valid address range")
  }
}

/** One boot line: where the client address comes from, and how it is hashed. */
export function describeClientAddressConfig(): string {
  const header = configuredEdgeHeader()
  const from = process.env.CLIENT_IP_HEADER_FROM?.trim() || "nowhere"
  const { scheme, fingerprint } = networkHashScheme()
  const source = header ? `${header} from ${from}` : "nearest untrusted hop"
  return `[client-address] source: ${source}; network hash: ${scheme}${fingerprint ? ` (key ${fingerprint})` : ""}`
}

/**
 * The hashed client network for a stored identity, with an explicit answer for
 * an address nobody knows:
 * - with `unknownScope` (free-grant signals): unique to that scope, so it can
 *   never match another account — EXCEPT a Cloudflare server, which a caller can
 *   choose to come from: those share one value, so the network rules still see
 *   everyone who arrives that way as one network;
 * - without it (caps, dedup, limits): the hop, exactly what these keyed on
 *   before — never worse than it was.
 */
export function clientNetworkHash(req: AddressedRequest, opts: { unknownScope?: string } = {}): string {
  const detail = resolveClientAddress(req)
  if (detail.address) return networkHash(networkKey(detail.address) ?? detail.address)
  if (opts.unknownScope === undefined) return networkHash(detail.hop ?? "unknown")
  if (detail.cloudflare) return networkHash("unknown:cloudflare")
  return networkHash(`unknown:${opts.unknownScope}`)
}

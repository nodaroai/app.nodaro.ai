/**
 * Address arithmetic — pure, no I/O.
 *
 * Moved out of `billing-key-resolver.ts` (which re-exports the CIDR helpers it
 * has always exported) so the client-address derivation (`client-address.ts`)
 * and every consumer of it share one parser instead of growing a second one.
 */

import { isIP } from "node:net"

export interface ParsedAddress {
  version: 4 | 6
  bits: bigint
}

const V4_MAPPED_PREFIX = 0xffffn

/**
 * Parse a bare address (no brackets, no port, no zone) into its bits.
 *
 * An IPv4-mapped IPv6 address IS the v4 address, in either spelling —
 * `::ffff:1.2.3.4` or the hex form `::ffff:102:304` — so a proxy that hands
 * one over still matches a `10.0.0.0/8` entry.
 */
export function parseAddress(raw: string): ParsedAddress | null {
  const version = isIP(raw)
  if (version === 4) {
    const octets = raw.split(".")
    let bits = 0n
    for (const o of octets) bits = (bits << 8n) | BigInt(Number(o))
    return { version: 4, bits }
  }
  if (version !== 6) return null

  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(raw)
  if (mapped?.[1]) return parseAddress(mapped[1])

  const [head, tail] = raw.includes("::") ? raw.split("::") : [raw, null]
  const headParts = head && head.length > 0 ? head.split(":") : []
  const tailParts = tail && tail.length > 0 ? tail.split(":") : []

  // A trailing dotted quad inside a v6 literal expands to two groups.
  const expand = (parts: string[]): string[] => {
    const out: string[] = []
    for (const p of parts) {
      if (p.includes(".")) {
        const v4 = parseAddress(p)
        if (!v4) return []
        out.push(((v4.bits >> 16n) & 0xffffn).toString(16), (v4.bits & 0xffffn).toString(16))
      } else {
        out.push(p)
      }
    }
    return out
  }

  const headGroups = expand(headParts)
  const tailGroups = expand(tailParts)
  const missing = 8 - headGroups.length - tailGroups.length
  if (missing < 0) return null
  const groups =
    tail === null ? headGroups : [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups]
  if (groups.length !== 8) return null

  let bits = 0n
  for (const g of groups) {
    const n = Number.parseInt(g === "" ? "0" : g, 16)
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) return null
    bits = (bits << 16n) | BigInt(n)
  }
  if (bits >> 32n === V4_MAPPED_PREFIX) return { version: 4, bits: bits & 0xffffffffn }
  return { version: 6, bits }
}

/** One spelling per address: dotted quad, or RFC 5952 (lowercase, longest zero run compressed). */
export function formatAddress(addr: ParsedAddress): string {
  if (addr.version === 4) {
    return [24n, 16n, 8n, 0n].map((shift) => String(Number((addr.bits >> shift) & 0xffn))).join(".")
  }
  const groups: number[] = []
  for (let i = 7; i >= 0; i--) groups.push(Number((addr.bits >> BigInt(i * 16)) & 0xffffn))

  let bestStart = -1
  let bestLen = 0
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++
      continue
    }
    let j = i
    while (j < 8 && groups[j] === 0) j++
    if (j - i > bestLen) {
      bestStart = i
      bestLen = j - i
    }
    i = j
  }
  const hex = groups.map((g) => g.toString(16))
  if (bestLen < 2) return hex.join(":")
  const head = hex.slice(0, bestStart).join(":")
  const tail = hex.slice(bestStart + bestLen).join(":")
  return `${head}::${tail}`
}

/**
 * A header value or socket address as one canonical address, or null.
 *
 * Accepts what forwarding headers actually carry — `[v6]`, `[v6]:port`,
 * `v4:port`, a v4-mapped v6 — and refuses anything with a zone id or that is
 * not an address at all.
 */
export function canonicalAddress(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null
  let value = raw.trim()
  if (value.length === 0 || value.length > 64) return null

  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value)
  if (bracketed?.[1]) {
    value = bracketed[1]
  } else {
    const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(value)
    if (v4WithPort?.[1]) value = v4WithPort[1]
  }
  if (value.includes("%")) return null

  const parsed = parseAddress(value)
  return parsed ? formatAddress(parsed) : null
}

/**
 * The unit a person is identified by on the network: an IPv4 address as is, a
 * public IPv6 address by its /64 — the prefix one subscriber line is handed,
 * inside which the low 64 bits rotate freely. An internal IPv6 address (a
 * self-host's LAN) stays whole: there one /64 is every machine in the office.
 */
export function networkKey(address: string): string | null {
  const parsed = parseAddress(address)
  if (!parsed) return null
  const canonical = formatAddress(parsed)
  if (parsed.version === 4 || isInternalHop(canonical)) return canonical
  const prefix = parsed.bits & ~((1n << 64n) - 1n)
  return `${formatAddress({ version: 6, bits: prefix })}/64`
}

/**
 * Canonicalise one entry of `allowedCidrs`, or null if it is not one.
 *
 * A bare address becomes a single-host block (`/32`, `/128`). HOST BITS SET
 * ARE A REFUSAL, not a silent mask: Postgres's `cidr` type rejects
 * `10.0.0.1/24` outright, so accepting it here would turn a typo into a 500 at
 * insert time — and quietly widening it to `10.0.0.0/24` would grant the key a
 * range the payer did not ask for.
 */
export function normalizeCidr(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const value = raw.trim()
  if (value.length === 0 || value.length > 64) return null

  const slash = value.lastIndexOf("/")
  const addressPart = slash === -1 ? value : value.slice(0, slash)
  // A zone-suffixed IPv6 literal (fe80::1%eth0) is not a range Postgres's cidr
  // type accepts; refuse it here (400) rather than let the insert fail (500).
  if (addressPart.includes("%")) return null
  const parsed = parseAddress(addressPart)
  if (!parsed) return null
  const width = parsed.version === 4 ? 32 : 128
  // Written back in its canonical spelling: an IPv4-mapped input becomes the
  // dotted IPv4 it means, which Postgres's cidr reads as v4 — the mapped
  // spelling with a v4 prefix would be a v6 network with host bits set (a 500).
  const canonical = formatAddress(parsed)

  if (slash === -1) return `${canonical}/${width}`

  const prefixPart = value.slice(slash + 1)
  if (!/^\d{1,3}$/.test(prefixPart)) return null
  const prefix = Number(prefixPart)
  if (prefix < 0 || prefix > width) return null

  const hostBits = BigInt(width - prefix)
  if (hostBits > 0n && (parsed.bits & ((1n << hostBits) - 1n)) !== 0n) return null
  return `${canonical}/${prefix}`
}

/**
 * Is `ip` inside any of `cidrs`? A null or empty list means "any source" —
 * the billing-key allowlist semantics. A DENY list must use `compileCidrList`,
 * whose empty list matches nothing.
 */
export function ipInAnyCidr(ip: string | null, cidrs: string[] | null | undefined): boolean {
  if (!cidrs || cidrs.length === 0) return true
  return compileCidrList(cidrs).matches(ip)
}

export interface CidrMatcher {
  /** Entries that parsed. */
  readonly size: number
  matches(address: string | null | undefined): boolean
}

interface CompiledRange {
  version: 4 | 6
  hostBits: bigint
  network: bigint
}

/**
 * Pre-parse a range list once. An empty (or wholly unparseable) list matches
 * NOTHING; an unparseable entry is skipped rather than widening the list.
 */
export function compileCidrList(cidrs: readonly string[]): CidrMatcher {
  const ranges: CompiledRange[] = []
  for (const entry of cidrs) {
    const slash = entry.lastIndexOf("/")
    if (slash === -1) continue
    const net = parseAddress(entry.slice(0, slash).trim())
    if (!net) continue
    const width = net.version === 4 ? 32 : 128
    const prefixText = entry.slice(slash + 1).trim()
    if (!/^\d{1,3}$/.test(prefixText)) continue
    const prefix = Number(prefixText)
    if (prefix < 0 || prefix > width) continue
    const hostBits = BigInt(width - prefix)
    ranges.push({ version: net.version, hostBits, network: net.bits >> hostBits })
  }
  return {
    size: ranges.length,
    matches(address) {
      if (!address || ranges.length === 0) return false
      const addr = parseAddress(address)
      if (!addr) return false
      return ranges.some((r) => r.version === addr.version && addr.bits >> r.hostBits === r.network)
    },
  }
}

/**
 * Hops that are our own infrastructure on any deployment: loopback, RFC 1918,
 * link-local, unique-local. NOT the shared-address space (100.64.0.0/10) — a
 * platform edge connects from there, and the derivation has to see it.
 */
const INTERNAL_HOP_RANGES = compileCidrList([
  "127.0.0.0/8",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "169.254.0.0/16",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
])

export function isInternalHop(address: string): boolean {
  return INTERNAL_HOP_RANGES.matches(address)
}

/**
 * Cloudflare's published edge ranges (https://www.cloudflare.com/ips/, read
 * 2026-10-04). A client address inside them is a Cloudflare server, never a
 * person — so the derivation treats it as unknown and an admin cannot block it.
 */
export const CLOUDFLARE_EDGE_RANGES: readonly string[] = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
]

const CLOUDFLARE_EDGE = compileCidrList(CLOUDFLARE_EDGE_RANGES)

export function isCloudflareEdgeAddress(address: string): boolean {
  return CLOUDFLARE_EDGE.matches(address)
}

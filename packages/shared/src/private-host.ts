/**
 * Which hosts a server-side fetch must never be pointed at: loopback, private,
 * link-local, cloud-metadata, multicast and reserved addresses. Pure and
 * dependency-free, so the server's SSRF gates (`safeFetch`, `safeUrlSchema`) and
 * the app runner's link card judge a host with the SAME rule — a link the card
 * accepts is not one the server then refuses for its address.
 *
 * Literal hosts only. A name that RESOLVES to a private address is caught where
 * the connection is made (`safeFetch` re-validates the resolved IP); nothing
 * here does DNS.
 *
 * The documentation blocks (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24,
 * 2001:db8::/32) are deliberately NOT refused: no network routes them, so they
 * are no SSRF target, and this same rule decides which client addresses the
 * server trusts and keys rate limits on (client-address.ts, hosting-ranges.ts),
 * where they stand in for public addresses.
 */

function isPrivateOrReservedIPv4(a: number, b: number, c: number): boolean {
  if (a === 0) return true                             // 0.0.0.0/8 "this network"
  if (a === 127) return true                           // 127.0.0.0/8 loopback
  if (a === 10) return true                            // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true     // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true              // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true              // 169.254.0.0/16 link-local + AWS/GCP metadata
  if (a === 100 && b >= 64 && b <= 127) return true    // 100.64.0.0/10 CGN
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 benchmarking
  if (a === 192 && b === 0 && c === 0) return true     // 192.0.0.0/24 IETF protocol assignments (DS-Lite, NAT64 discovery)
  if (a >= 224) return true                            // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255
  return false
}

/** The IPv4 address carried in two 16-bit groups. */
function embeddedIPv4IsPrivate(hi: number, lo: number): boolean {
  return isPrivateOrReservedIPv4(hi >> 8, hi & 0xff, lo >> 8)
}

/**
 * The eight 16-bit groups of an IPv6 address, or null when `ip` is not one.
 * Reads `::` compression, a dotted IPv4 tail (`::ffff:127.0.0.1`) and a zone
 * suffix (`fe80::1%eth0`).
 */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase()
  const zone = text.indexOf("%")
  if (zone >= 0) text = text.slice(0, zone)
  if (!text.includes(":") || !/^[0-9a-f:.]+$/.test(text)) return null

  const lastColon = text.lastIndexOf(":")
  const last = text.slice(lastColon + 1)
  if (last.includes(".")) {
    const parts = last.split(".")
    if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null
    const [a, b, c, d] = parts.map(Number) as [number, number, number, number]
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }

  const halves = text.split("::")
  if (halves.length > 2) return null
  const groupsOf = (part: string) => (part === "" ? [] : part.split(":"))
  const head = groupsOf(halves[0] ?? "")
  const tail = halves.length === 2 ? groupsOf(halves[1] ?? "") : []
  if ([...head, ...tail].some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  if (halves.length === 1) {
    return head.length === 8 ? head.map((g) => parseInt(g, 16)) : null
  }
  const missing = 8 - head.length - tail.length
  if (missing < 1) return null
  return [...head, ...Array<string>(missing).fill("0"), ...tail].map((g) => parseInt(g, 16))
}

function isPrivateOrReservedIPv6(g: number[]): boolean {
  const zeroThrough = (n: number) => g.slice(0, n).every((x) => x === 0)
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, , g5 = 0, g6 = 0, g7 = 0] = g
  if (zeroThrough(8)) return true                                    // :: unspecified
  if (zeroThrough(7) && g7 === 1) return true                        // ::1 loopback
  if (zeroThrough(5) && g5 === 0xffff) return embeddedIPv4IsPrivate(g6, g7) // ::ffff:0:0/96 IPv4-mapped
  if (zeroThrough(6)) return embeddedIPv4IsPrivate(g6, g7)           // ::/96 IPv4-compatible (deprecated)
  if (g0 === 0x64 && g1 === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return embeddedIPv4IsPrivate(g6, g7)                             // 64:ff9b::/96 NAT64: the IPv4 it reaches
  }
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return true          // 64:ff9b:1::/48 local-use NAT64
  if (g0 === 0x2002) return embeddedIPv4IsPrivate(g1, g2)            // 2002::/16 6to4: the IPv4 it reaches
  if (g0 === 0x2001 && g1 === 0) return true                         // 2001::/32 Teredo
  if ((g0 & 0xfe00) === 0xfc00) return true                          // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80) return true                          // fe80::/10 link-local (fe80:: to febf::)
  if ((g0 & 0xffc0) === 0xfec0) return true                          // fec0::/10 site-local (deprecated)
  if ((g0 & 0xff00) === 0xff00) return true                          // ff00::/8 multicast
  return false
}

/**
 * True if the IP belongs to a range we refuse to connect to from server-side
 * fetches. Covers IPv4 loopback/private/link-local/cloud-metadata/CGN/
 * multicast/reserved, the equivalent IPv6 classes, and every
 * IPv6 form that carries an IPv4 address (mapped, compatible, NAT64, 6to4 —
 * judged by the IPv4 they reach). Something with a colon that is not a valid
 * IPv6 address is refused (fail closed); anything else that is not an IP (a
 * host name) is not refused here.
 */
export function isPrivateOrReservedIP(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    return isPrivateOrReservedIPv4(Number(v4[1]), Number(v4[2]), Number(v4[3]))
  }
  if (!ip.includes(":")) return false
  const groups = ipv6Groups(ip)
  return groups === null ? true : isPrivateOrReservedIPv6(groups)
}

/**
 * True when a URL hostname (as `new URL(...).hostname` gives it, IPv6 still in
 * brackets) names this machine or a private/reserved IP literal. WHATWG parsing
 * has already folded decimal, octal and hex IPv4 spellings (`2130706433`,
 * `0x7f.1`) into dotted form, so those are caught as IP literals.
 */
export function isLocalOrPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")
  if (host === "localhost" || host.endsWith(".localhost")) return true
  return isPrivateOrReservedIP(host)
}

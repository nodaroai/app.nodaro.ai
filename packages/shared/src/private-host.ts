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
 */

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
  if (lower.startsWith("::") && lower !== "::" && lower !== "::1") {
    // IPv4-compatible IPv6 (deprecated ::/96): the low 32 bits are an IPv4.
    // WHATWG URL parsing presents `::127.0.0.1` as EITHER a dotted tail or two
    // hex quads (`::7f00:1`), exactly like the ::ffff: case above — handle both,
    // or the canonical hex form silently fails open.
    const tail = lower.slice(2)
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(tail)) {
      return isPrivateOrReservedIP(tail)
    }
    const parts = tail.split(":")
    if (parts.length === 2 && /^[0-9a-f]{1,4}$/.test(parts[0]) && /^[0-9a-f]{1,4}$/.test(parts[1])) {
      const hi = parseInt(parts[0], 16)
      const lo = parseInt(parts[1], 16)
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        return isPrivateOrReservedIP(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`)
      }
    }
  }
  return false
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

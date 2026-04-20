import { describe, it, expect } from "vitest"
import { isPrivateOrReservedIP, safeFetch } from "../safe-fetch.js"

// ---------------------------------------------------------------------------
// IP classifier — exercises the raw blocklist. The runtime path (DNS-lookup
// rejection via undici Agent.connect.lookup) isn't unit-tested because it
// requires coupling to undici internals; it's exercised via integration
// behaviour (safeFetch rejects literal private IPs at the fast-fail gate,
// which shares the same classifier).
// ---------------------------------------------------------------------------

describe("isPrivateOrReservedIP", () => {
  it("blocks IPv4 loopback, private, link-local, metadata, CGN, benchmarking, multicast, reserved", () => {
    expect(isPrivateOrReservedIP("127.0.0.1")).toBe(true)
    expect(isPrivateOrReservedIP("127.255.255.255")).toBe(true)
    expect(isPrivateOrReservedIP("10.0.0.1")).toBe(true)
    expect(isPrivateOrReservedIP("172.15.0.1")).toBe(false)
    expect(isPrivateOrReservedIP("172.16.0.1")).toBe(true)
    expect(isPrivateOrReservedIP("172.31.255.255")).toBe(true)
    expect(isPrivateOrReservedIP("172.32.0.1")).toBe(false)
    expect(isPrivateOrReservedIP("192.168.0.1")).toBe(true)
    expect(isPrivateOrReservedIP("169.254.1.1")).toBe(true)
    expect(isPrivateOrReservedIP("169.254.169.254")).toBe(true) // AWS/GCP metadata
    expect(isPrivateOrReservedIP("0.0.0.0")).toBe(true)
    expect(isPrivateOrReservedIP("0.1.2.3")).toBe(true)
    expect(isPrivateOrReservedIP("100.64.0.1")).toBe(true)
    expect(isPrivateOrReservedIP("100.127.255.255")).toBe(true)
    expect(isPrivateOrReservedIP("100.63.0.1")).toBe(false)
    expect(isPrivateOrReservedIP("198.18.0.1")).toBe(true)
    expect(isPrivateOrReservedIP("198.20.0.1")).toBe(false)
    expect(isPrivateOrReservedIP("224.0.0.1")).toBe(true)
    expect(isPrivateOrReservedIP("239.255.255.255")).toBe(true)
    expect(isPrivateOrReservedIP("255.255.255.255")).toBe(true)
  })

  it("accepts public IPv4 addresses", () => {
    expect(isPrivateOrReservedIP("8.8.8.8")).toBe(false)
    expect(isPrivateOrReservedIP("1.1.1.1")).toBe(false)
    expect(isPrivateOrReservedIP("140.82.114.4")).toBe(false) // github.com
  })

  it("blocks IPv6 loopback, unspecified, link-local, ULA, multicast", () => {
    expect(isPrivateOrReservedIP("::1")).toBe(true)
    expect(isPrivateOrReservedIP("::")).toBe(true)
    expect(isPrivateOrReservedIP("fe80::1")).toBe(true)
    expect(isPrivateOrReservedIP("fc00::1")).toBe(true)
    expect(isPrivateOrReservedIP("fd12:3456:789a::1")).toBe(true)
    expect(isPrivateOrReservedIP("ff02::1")).toBe(true)
  })

  it("blocks IPv4-mapped IPv6 in both dotted and normalised hex forms", () => {
    // Dotted form — straight lookup of embedded IPv4.
    expect(isPrivateOrReservedIP("::ffff:127.0.0.1")).toBe(true)
    expect(isPrivateOrReservedIP("::ffff:169.254.169.254")).toBe(true)
    expect(isPrivateOrReservedIP("::ffff:10.0.0.1")).toBe(true)
    // WHATWG URL parser normalises the dotted tail into hex quads, e.g.
    // 127.0.0.1 → 7f00:0001 → written as 7f00:1. Must still block.
    expect(isPrivateOrReservedIP("::ffff:7f00:1")).toBe(true)       // 127.0.0.1
    expect(isPrivateOrReservedIP("::ffff:a9fe:a9fe")).toBe(true)    // 169.254.169.254
    expect(isPrivateOrReservedIP("::ffff:a00:1")).toBe(true)        // 10.0.0.1
    expect(isPrivateOrReservedIP("::ffff:c0a8:1")).toBe(true)       // 192.168.0.1
  })

  it("accepts public IPv6 addresses", () => {
    expect(isPrivateOrReservedIP("2606:4700:4700::1111")).toBe(false) // cloudflare DNS
  })
})

// ---------------------------------------------------------------------------
// Fast-fail before any network call / DNS resolution
// ---------------------------------------------------------------------------

describe("safeFetch — fast-fail", () => {
  it("rejects non-http(s) protocols synchronously", async () => {
    await expect(safeFetch("ftp://example.com/file")).rejects.toThrow(/protocol ftp/)
    await expect(safeFetch("file:///etc/passwd")).rejects.toThrow(/protocol file/)
  })

  it("rejects literal private IPv4 before DNS resolution", async () => {
    await expect(safeFetch("http://127.0.0.1/secret")).rejects.toThrow(/127\.0\.0\.1/)
    await expect(safeFetch("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/169\.254\.169\.254/)
    await expect(safeFetch("http://10.0.0.1/internal")).rejects.toThrow(/10\.0\.0\.1/)
    await expect(safeFetch("http://192.168.1.1/internal")).rejects.toThrow(/192\.168\.1\.1/)
  })

  it("rejects literal IPv6 loopback, link-local, ULA", async () => {
    await expect(safeFetch("http://[::1]/api")).rejects.toThrow(/::1/)
    await expect(safeFetch("http://[fe80::1]/api")).rejects.toThrow(/fe80::1/)
    await expect(safeFetch("http://[fc00::1]/api")).rejects.toThrow(/fc00::1/)
  })
})

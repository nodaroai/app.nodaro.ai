import { describe, it, expect } from "vitest"
import {
  canonicalAddress,
  compileCidrList,
  formatAddress,
  ipInAnyCidr,
  isCloudflareEdgeAddress,
  isInternalHop,
  networkKey,
  parseAddress,
} from "../ip-address.js"

describe("parseAddress", () => {
  it("parses IPv4 and IPv6", () => {
    expect(parseAddress("203.0.113.7")).toEqual({ version: 4, bits: 0xcb007107n })
    expect(parseAddress("::1")?.version).toBe(6)
    expect(parseAddress("not an address")).toBeNull()
  })

  it("reads an IPv4-mapped address as the IPv4 address in BOTH spellings", () => {
    expect(parseAddress("::ffff:10.1.2.3")).toEqual(parseAddress("10.1.2.3"))
    // The hex form a URL parser or a proxy may hand over.
    expect(parseAddress("::ffff:a01:203")).toEqual(parseAddress("10.1.2.3"))
  })
})

describe("formatAddress (one spelling per address)", () => {
  it("compresses the longest zero run, lowercase", () => {
    expect(formatAddress(parseAddress("2001:0DB8:0000:0000:0000:0000:0000:0001")!)).toBe("2001:db8::1")
    expect(formatAddress(parseAddress("2001:db8:0:0:1:0:0:1")!)).toBe("2001:db8::1:0:0:1")
    expect(formatAddress(parseAddress("::")!)).toBe("::")
    expect(formatAddress(parseAddress("2001:db8:1:2:3:4:5:6")!)).toBe("2001:db8:1:2:3:4:5:6")
  })
})

describe("canonicalAddress", () => {
  it("accepts what forwarding headers carry", () => {
    expect(canonicalAddress(" 203.0.113.7 ")).toBe("203.0.113.7")
    expect(canonicalAddress("203.0.113.7:4431")).toBe("203.0.113.7")
    expect(canonicalAddress("[2001:DB8::1]")).toBe("2001:db8::1")
    expect(canonicalAddress("[2001:db8::1]:443")).toBe("2001:db8::1")
    expect(canonicalAddress("::ffff:127.0.0.1")).toBe("127.0.0.1")
  })

  it("refuses zone ids, garbage and empty input", () => {
    expect(canonicalAddress("fe80::1%eth0")).toBeNull()
    expect(canonicalAddress("unknown")).toBeNull()
    expect(canonicalAddress("")).toBeNull()
    expect(canonicalAddress(undefined)).toBeNull()
    expect(canonicalAddress("1.2.3.4, 5.6.7.8")).toBeNull()
  })
})

describe("networkKey", () => {
  it("is the IPv4 address itself", () => {
    expect(networkKey("203.0.113.7")).toBe("203.0.113.7")
    expect(networkKey("::ffff:203.0.113.7")).toBe("203.0.113.7")
  })

  it("keeps an internal IPv6 address whole (a LAN's /64 is every machine on it)", () => {
    expect(networkKey("fd12::5")).toBe("fd12::5")
    expect(networkKey("fe80::1")).toBe("fe80::1")
  })

  it("is the /64 for IPv6, so a rotating interface id stays one network", () => {
    expect(networkKey("2001:db8:abcd:12:1:2:3:4")).toBe("2001:db8:abcd:12::/64")
    expect(networkKey("2001:db8:abcd:12:ffff:ffff:ffff:ffff")).toBe("2001:db8:abcd:12::/64")
    expect(networkKey("2001:db8:abcd:13::1")).not.toBe(networkKey("2001:db8:abcd:12::1"))
  })
})

describe("compileCidrList (a DENY-list matcher)", () => {
  it("matches NOTHING when empty — unlike ipInAnyCidr's allowlist semantics", () => {
    expect(compileCidrList([]).matches("203.0.113.7")).toBe(false)
    expect(ipInAnyCidr("203.0.113.7", [])).toBe(true)
  })

  it("skips unparseable entries instead of widening", () => {
    const m = compileCidrList(["garbage", "10.0.0.0/8", "1.2.3.4/99"])
    expect(m.size).toBe(1)
    expect(m.matches("10.9.9.9")).toBe(true)
    expect(m.matches("11.0.0.1")).toBe(false)
  })

  it("never matches across families, null, or garbage", () => {
    const m = compileCidrList(["10.0.0.0/8", "2001:db8::/32"])
    expect(m.matches("2001:db8::1")).toBe(true)
    expect(m.matches("::ffff:10.0.0.1")).toBe(true)
    expect(m.matches(null)).toBe(false)
    expect(m.matches("nope")).toBe(false)
  })
})

describe("isInternalHop", () => {
  it("covers loopback, RFC 1918, link-local and unique-local", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.1.1", "::1", "fd12::1", "fe80::1"]) {
      expect(isInternalHop(a), a).toBe(true)
    }
  })

  it("does NOT cover the shared-address space a platform edge connects from", () => {
    expect(isInternalHop("100.64.3.4")).toBe(false)
    expect(isInternalHop("203.0.113.7")).toBe(false)
  })
})

describe("isCloudflareEdgeAddress", () => {
  it("knows Cloudflare's ranges in both families", () => {
    expect(isCloudflareEdgeAddress("172.64.1.1")).toBe(true)
    expect(isCloudflareEdgeAddress("2606:4700::1")).toBe(true)
    expect(isCloudflareEdgeAddress("203.0.113.7")).toBe(false)
  })
})

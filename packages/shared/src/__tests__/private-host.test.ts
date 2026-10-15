import { describe, expect, it } from "vitest"
import { isLocalOrPrivateHostname, isPrivateOrReservedIP } from "../private-host.js"

describe("isPrivateOrReservedIP", () => {
  it("refuses loopback, private, link-local, CGN, multicast and mapped addresses", () => {
    for (const ip of ["0.0.0.0", "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254", "100.64.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255", "::", "::1", "fe80::1", "fd00::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::7f00:1"]) {
      expect(isPrivateOrReservedIP(ip), ip).toBe(true)
    }
  })
  it("passes public addresses", () => {
    for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700::1"]) expect(isPrivateOrReservedIP(ip), ip).toBe(false)
  })

  it("refuses the whole of link-local fe80::/10 (fe80:: to febf::) and the old site-local fec0::/10", () => {
    for (const ip of ["fe80::1", "fe90::1", "fea0::abcd", "febf:ffff::1", "FE85::1", "fe80::1%eth0", "fec0::1", "feff::1"]) {
      expect(isPrivateOrReservedIP(ip), ip).toBe(true)
    }
    expect(isPrivateOrReservedIP("fe7f::1")).toBe(false) // just below fe80::/10
  })

  it("judges an IPv6 address that carries an IPv4 one by the IPv4 it reaches (NAT64, 6to4, mapped, compatible)", () => {
    for (const ip of [
      "64:ff9b::a9fe:a9fe", // NAT64 → 169.254.169.254
      "64:ff9b::7f00:1", // NAT64 → 127.0.0.1
      "64:ff9b::10.0.0.1", // NAT64, dotted tail
      "2002:a9fe:a9fe::1", // 6to4 → 169.254.169.254
      "2002:c0a8:0101::", // 6to4 → 192.168.1.1
      "::ffff:a9fe:a9fe",
      "0:0:0:0:0:ffff:127.0.0.1",
      "::2", // IPv4-compatible 0.0.0.2
    ]) {
      expect(isPrivateOrReservedIP(ip), ip).toBe(true)
    }
    for (const ip of ["64:ff9b::808:808", "64:ff9b::8.8.8.8", "2002:808:808::1", "::ffff:808:808"]) {
      expect(isPrivateOrReservedIP(ip), ip).toBe(false)
    }
  })

  it("refuses local-use NAT64 and Teredo", () => {
    for (const ip of ["64:ff9b:1::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001::1"]) {
      expect(isPrivateOrReservedIP(ip), ip).toBe(true)
    }
    expect(isPrivateOrReservedIP("2001:4860:4860::8888")).toBe(false) // a public 2001: address
  })

  it("refuses the IETF protocol block of IPv4", () => {
    expect(isPrivateOrReservedIP("192.0.0.170")).toBe(true)
    expect(isPrivateOrReservedIP("192.0.1.1")).toBe(false)
  })

  // Unroutable, so no SSRF target — and the same rule decides which client
  // addresses the server trusts and keys rate limits on, where these stand in
  // for public addresses (client-address.ts). Refusing them would make a
  // documentation address an "unknown" client.
  it("does not refuse the documentation blocks", () => {
    for (const ip of ["192.0.2.1", "198.51.100.7", "203.0.113.9", "2001:db8::1", "2001:db8:abcd:12::1"]) {
      expect(isPrivateOrReservedIP(ip), ip).toBe(false)
    }
  })

  it("fails closed on something with a colon that is not an IPv6 address", () => {
    for (const ip of ["::ffff:zzzz", "1:2:3", "1::2::3", "::ffff:300.1.1.1", "1:2:3:4:5:6:7:8:9"]) {
      expect(isPrivateOrReservedIP(ip), ip).toBe(true)
    }
  })
})

describe("isLocalOrPrivateHostname", () => {
  it("reads a URL hostname the way the server's SSRF schema does", () => {
    for (const host of ["localhost", "LOCALHOST", "localhost.", "app.localhost", "[::1]", "[fe80::1]", "127.0.0.1", "192.168.1.5"]) {
      expect(isLocalOrPrivateHostname(host), host).toBe(true)
    }
    for (const host of ["cdn.example.com", "youtube.com", "93.184.216.34", "[2606:4700::1]", "localhost.example.com", "notlocalhost"]) {
      expect(isLocalOrPrivateHostname(host), host).toBe(false)
    }
  })
})

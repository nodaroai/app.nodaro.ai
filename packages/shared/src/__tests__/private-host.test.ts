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

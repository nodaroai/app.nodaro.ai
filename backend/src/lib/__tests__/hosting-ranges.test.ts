import { describe, it, expect } from "vitest"
import { hostingRangesInfo, isHostingAddress } from "../hosting-ranges.js"

describe("hosting ranges — the providers' own published lists", () => {
  it("loads a list with every expected provider and thousands of ranges", () => {
    const info = hostingRangesInfo()
    expect(info.providers).toEqual(expect.arrayContaining(["aws", "gcp", "oracle", "digitalocean", "linode", "vultr"]))
    expect(info.ranges).toBeGreaterThan(5_000)
    expect(info.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("an AWS address is hosting (the wave signed up from EC2 in three regions)", () => {
    expect(isHostingAddress("3.0.52.173")).toBe(true) // ap-southeast-1
    expect(isHostingAddress("54.199.154.222")).toBe(true) // ap-northeast-1
  })

  it("a residential or carrier address is not, nor is nothing", () => {
    expect(isHostingAddress("14.136.53.150")).toBe(false) // Hong Kong Broadband
    expect(isHostingAddress("192.168.1.10")).toBe(false)
    expect(isHostingAddress(null)).toBe(false)
    expect(isHostingAddress("not an address")).toBe(false)
  })
})

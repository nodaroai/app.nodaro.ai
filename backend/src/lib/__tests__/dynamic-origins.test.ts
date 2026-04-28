import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../supabase.js", () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: [{ allowed_origins: ["https://app1.com", "https://app2.com"] }] }),
  },
}))

import { isOriginAllowedDynamic, invalidateDynamicOriginsCache } from "../dynamic-origins.js"

beforeEach(() => {
  invalidateDynamicOriginsCache()
})

describe("dynamic origins", () => {
  it("includes static origins (localhost dev)", async () => {
    expect(await isOriginAllowedDynamic("http://localhost:3000")).toBe(true)
  })

  it("includes registered app origins", async () => {
    expect(await isOriginAllowedDynamic("https://app1.com")).toBe(true)
    expect(await isOriginAllowedDynamic("https://app2.com")).toBe(true)
  })

  it("rejects unregistered origin", async () => {
    expect(await isOriginAllowedDynamic("https://evil.com")).toBe(false)
  })

  it("rejects undefined", async () => {
    expect(await isOriginAllowedDynamic(undefined)).toBe(false)
  })
})

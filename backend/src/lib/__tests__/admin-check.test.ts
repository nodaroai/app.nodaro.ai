import { describe, it, expect, vi, beforeEach } from "vitest"

const singleMock = vi.fn()
vi.mock("../supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: singleMock,
        }),
      }),
    })),
  },
}))

import { checkIsAdmin, warmAdminCache } from "../admin-check.js"

const uniqueUserId = (): string => `user-${Math.random().toString(36).slice(2)}`

describe("checkIsAdmin", () => {
  beforeEach(() => {
    singleMock.mockReset()
  })

  it("returns true for role 'admin'", async () => {
    const userId = uniqueUserId()
    singleMock.mockResolvedValue({ data: { role: "admin" }, error: null })
    expect(await checkIsAdmin(userId)).toBe(true)
  })

  it("returns true for role 'super_admin'", async () => {
    const userId = uniqueUserId()
    singleMock.mockResolvedValue({ data: { role: "super_admin" }, error: null })
    expect(await checkIsAdmin(userId)).toBe(true)
  })

  it("returns false for non-admin role", async () => {
    const userId = uniqueUserId()
    singleMock.mockResolvedValue({ data: { role: "user" }, error: null })
    expect(await checkIsAdmin(userId)).toBe(false)
  })

  it("returns false when profile not found (PGRST116)", async () => {
    const userId = uniqueUserId()
    singleMock.mockResolvedValue({ data: null, error: { code: "PGRST116" } })
    expect(await checkIsAdmin(userId)).toBe(false)
  })

  it("throws for other DB errors", async () => {
    const userId = uniqueUserId()
    singleMock.mockResolvedValue({ data: null, error: { code: "OTHER", message: "boom" } })
    await expect(checkIsAdmin(userId)).rejects.toThrow(/boom/)
  })

  it("caches the result (second call skips DB)", async () => {
    const userId = uniqueUserId()
    singleMock.mockResolvedValueOnce({ data: { role: "admin" }, error: null })
    expect(await checkIsAdmin(userId)).toBe(true)
    // Even if DB now returns non-admin, cache still says true
    singleMock.mockResolvedValueOnce({ data: { role: "user" }, error: null })
    expect(await checkIsAdmin(userId)).toBe(true)
    expect(singleMock).toHaveBeenCalledTimes(1)
  })
})

describe("warmAdminCache", () => {
  beforeEach(() => {
    singleMock.mockReset()
  })

  it("primes cache so checkIsAdmin skips DB", async () => {
    const userId = uniqueUserId()
    warmAdminCache(userId, "admin")
    expect(await checkIsAdmin(userId)).toBe(true)
    expect(singleMock).not.toHaveBeenCalled()
  })

  it("stores false for non-admin role", async () => {
    const userId = uniqueUserId()
    warmAdminCache(userId, "user")
    expect(await checkIsAdmin(userId)).toBe(false)
    expect(singleMock).not.toHaveBeenCalled()
  })

  it("treats null/undefined role as non-admin", async () => {
    const u1 = uniqueUserId()
    const u2 = uniqueUserId()
    warmAdminCache(u1, null)
    warmAdminCache(u2, undefined)
    expect(await checkIsAdmin(u1)).toBe(false)
    expect(await checkIsAdmin(u2)).toBe(false)
  })
})

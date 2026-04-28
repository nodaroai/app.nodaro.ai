import { describe, it, expect, vi, beforeEach } from "vitest"

describe("stripe-client lazy initialization", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("does NOT throw at module import time when STRIPE_SECRET_KEY is empty", async () => {
    // Community edition: STRIPE_SECRET_KEY defaults to ""
    const originalKey = process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_SECRET_KEY  // Force the empty-string default in config
    try {
      // The import itself must succeed without throwing
      await expect(import("../stripe-client.js")).resolves.toBeDefined()
    } finally {
      if (originalKey !== undefined) process.env.STRIPE_SECRET_KEY = originalKey
    }
  })

  it("throws a helpful error when getStripe() is called without a key", async () => {
    const originalKey = process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_SECRET_KEY
    try {
      const mod = await import("../stripe-client.js")
      expect(() => mod.getStripe()).toThrow(/STRIPE_SECRET_KEY/)
    } finally {
      if (originalKey !== undefined) process.env.STRIPE_SECRET_KEY = originalKey
    }
  })

  it("returns a working Stripe instance when key is present", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy_for_init_only"
    try {
      const mod = await import("../stripe-client.js")
      expect(mod.getStripe()).toBeDefined()
      // Should be the same instance on subsequent calls (singleton)
      expect(mod.getStripe()).toBe(mod.getStripe())
    } finally {
      delete process.env.STRIPE_SECRET_KEY
    }
  })
})

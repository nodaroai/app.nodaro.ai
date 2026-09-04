import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

describe("edition helpers", () => {
  describe("cloud edition (default from setup.ts)", () => {
    it("isCloud returns true", async () => {
      const { isCloud } = await import("../config.js")
      expect(isCloud()).toBe(true)
    })

    it("isCommunity returns false", async () => {
      const { isCommunity } = await import("../config.js")
      expect(isCommunity()).toBe(false)
    })

    it("isBusiness returns false", async () => {
      const { isBusiness } = await import("../config.js")
      expect(isBusiness()).toBe(false)
    })

    it("hasAdmin returns true", async () => {
      const { hasAdmin } = await import("../config.js")
      expect(hasAdmin()).toBe(true)
    })

    it("hasCredits returns true", async () => {
      const { hasCredits } = await import("../config.js")
      expect(hasCredits()).toBe(true)
    })
  })

  describe("community edition", () => {
    beforeEach(() => {
      vi.resetModules()
    })

    it("returns correct values for community", async () => {
      vi.doMock("../config.js", () => ({
        config: { EDITION: "community" },
        isCommunity: () => true,
        isBusiness: () => false,
        isCloud: () => false,
        hasAdmin: () => false,
        hasCredits: () => false,
      }))
      const mod = await import("../config.js")
      expect(mod.isCommunity()).toBe(true)
      expect(mod.isBusiness()).toBe(false)
      expect(mod.isCloud()).toBe(false)
      expect(mod.hasAdmin()).toBe(false)
      expect(mod.hasCredits()).toBe(false)
    })
  })

  describe("business edition", () => {
    beforeEach(() => {
      vi.resetModules()
    })

    it("returns correct values for business", async () => {
      vi.doMock("../config.js", () => ({
        config: { EDITION: "business" },
        isCommunity: () => false,
        isBusiness: () => true,
        isCloud: () => false,
        hasAdmin: () => true,
        hasCredits: () => false,
      }))
      const mod = await import("../config.js")
      expect(mod.isCommunity()).toBe(false)
      expect(mod.isBusiness()).toBe(true)
      expect(mod.isCloud()).toBe(false)
      expect(mod.hasAdmin()).toBe(true)
      expect(mod.hasCredits()).toBe(false)
    })
  })
})

/**
 * R2_SHARED_WITH_RELAY_TARGET — the shared-bucket passthrough flag
 * (spec 2026-09-04-sai-local-development §9.2, D17).
 *
 * The flag asserts a DEPLOYMENT FACT: this instance's R2_PUBLIC_URL names the
 * same bucket its relay target writes to, so a finished relayed output is
 * already an object in our own bucket and `uploadToR2` must return it rather
 * than copy it.
 *
 * The parse is the reason this block exists. `docker-compose.local.yml` writes
 * the literal string "false" for a laptop, which has its own MinIO and shares
 * nothing. Under `z.coerce.boolean()` that string is truthy, so EVERY laptop
 * would silently turn the passthrough on and point its job rows at objects its
 * MinIO does not contain — a broken gallery with no error anywhere. The repo
 * already documents this trap on R2_FORCE_PATH_STYLE and MCP_ENABLED; these
 * four cases pin it for this key too.
 */
describe("R2_SHARED_WITH_RELAY_TARGET strict parsing", () => {
  const ORIGINAL = process.env.R2_SHARED_WITH_RELAY_TARGET

  beforeEach(() => {
    // Clear vitest's module cache so the next import re-evaluates the schema
    // against the current process.env (same shape as config-mcp.test.ts).
    vi.resetModules()
    // The edition blocks above register `vi.doMock("../config.js", …)` inside
    // their `it`s, and a doMock registration outlives resetModules — without
    // this, `import("../config.js")` here would resolve to their hand-written
    // `{ config: { EDITION: "business" } }` stub and every assertion below
    // would read `undefined` no matter what the real schema does.
    vi.doUnmock("../config.js")
  })

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.R2_SHARED_WITH_RELAY_TARGET
    else process.env.R2_SHARED_WITH_RELAY_TARGET = ORIGINAL
  })

  it("parses 'true' as true", async () => {
    process.env.R2_SHARED_WITH_RELAY_TARGET = "true"
    const { config } = await import("../config.js")
    expect(config.R2_SHARED_WITH_RELAY_TARGET).toBe(true)
  })

  it("parses '1' as true", async () => {
    process.env.R2_SHARED_WITH_RELAY_TARGET = "1"
    const { config } = await import("../config.js")
    expect(config.R2_SHARED_WITH_RELAY_TARGET).toBe(true)
  })

  it("parses 'false' as FALSE — z.coerce.boolean() would make it true", async () => {
    process.env.R2_SHARED_WITH_RELAY_TARGET = "false"
    const { config } = await import("../config.js")
    expect(config.R2_SHARED_WITH_RELAY_TARGET).toBe(false)
  })

  it("treats an unset env var as false (the default: no passthrough)", async () => {
    delete process.env.R2_SHARED_WITH_RELAY_TARGET
    const { config } = await import("../config.js")
    expect(config.R2_SHARED_WITH_RELAY_TARGET).toBe(false)
  })
})

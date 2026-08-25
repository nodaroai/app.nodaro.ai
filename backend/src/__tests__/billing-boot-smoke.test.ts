import { describe, it, expect, afterEach, vi } from "vitest"

// The cloud case dynamically loads the real ee provider, which imports
// lib/supabase.js — mock it so the module graph loads under stub env.
vi.mock("../lib/supabase.js", () => ({ supabase: { from: () => ({}) } }))

afterEach(() => { vi.resetModules(); vi.doUnmock("../lib/config.js") })

describe("billing provider boot wiring by edition", () => {
  it("community/business: register is a no-op → none", async () => {
    vi.doMock("../lib/config.js", async (imp) => ({ ...(await imp() as object), hasCredits: () => false }))
    const { registerNodaroCloudBillingProvider: reg, getBillingProvider: get } = await import("../lib/billing-provider.js")
    await reg()
    expect(get().id).toBe("none")
  })
  it("cloud: register installs nodaro-cloud", async () => {
    vi.doMock("../lib/config.js", async (imp) => ({ ...(await imp() as object), hasCredits: () => true }))
    const { registerNodaroCloudBillingProvider: reg, getBillingProvider: get } = await import("../lib/billing-provider.js")
    await reg()
    expect(get().id).toBe("nodaro-cloud")
  })
})

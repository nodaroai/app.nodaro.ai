import { describe, it, expect, vi, beforeEach } from "vitest"

// The app_settings version read unreadable: the TTL-only behaviour, and no
// extra `from()` call in the mocked sequence (the version itself:
// ee/lib/__tests__/app-settings-config-caches.test.ts).
vi.mock("@/lib/app-settings-version.js", () => ({
  appSettingsVersion: async () => null,
  appSettingsChangedSince: async () => false,
  forgetAppSettingsVersion: () => {},
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import {
  getWelcomeOfferConfig,
  invalidateWelcomeOfferConfigCache,
  WELCOME_OFFER_CONFIG_DEFAULTS,
  WELCOME_OFFER_ENABLED_KEY,
} from "../welcome-offer-config.js"
import { supabase } from "../../../lib/supabase.js"

function mockSetting(row: { key: string; value: unknown } | null, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  vi.mocked(supabase.from).mockReturnValue({ select } as never)
  return { select, eq }
}

beforeEach(() => {
  vi.clearAllMocks()
  invalidateWelcomeOfferConfigCache()
})

describe("getWelcomeOfferConfig", () => {
  it("is OFF when no row exists — today's behaviour is the default", async () => {
    mockSetting(null)
    const cfg = await getWelcomeOfferConfig()
    expect(cfg).toEqual(WELCOME_OFFER_CONFIG_DEFAULTS)
    expect(cfg.enabled).toBe(false)
  })

  it("reads exactly the one key", async () => {
    const { eq } = mockSetting({ key: WELCOME_OFFER_ENABLED_KEY, value: true })
    await getWelcomeOfferConfig()
    expect(eq).toHaveBeenCalledWith("key", "welcome_offer_enabled")
  })

  it("turns on for a boolean true", async () => {
    mockSetting({ key: WELCOME_OFFER_ENABLED_KEY, value: true })
    expect((await getWelcomeOfferConfig()).enabled).toBe(true)
  })

  it("ignores a non-boolean value (a stray string cannot switch the gate on)", async () => {
    mockSetting({ key: WELCOME_OFFER_ENABLED_KEY, value: "true" })
    expect((await getWelcomeOfferConfig()).enabled).toBe(false)
  })

  it("a cold-cache DB error is OFF and never throws", async () => {
    mockSetting(null, { message: "boom" })
    expect((await getWelcomeOfferConfig()).enabled).toBe(false)
  })

  it("a cold-cache client throw (table missing) is OFF", async () => {
    vi.mocked(supabase.from).mockImplementation(() => {
      throw new Error("relation does not exist")
    })
    expect((await getWelcomeOfferConfig()).enabled).toBe(false)
  })

  it("a transient read error keeps the last good answer — ON stays ON — and retries soon", async () => {
    vi.useFakeTimers()
    try {
      mockSetting({ key: WELCOME_OFFER_ENABLED_KEY, value: true })
      expect((await getWelcomeOfferConfig()).enabled).toBe(true)
      vi.advanceTimersByTime(61_000)
      mockSetting(null, { message: "blip" })
      expect((await getWelcomeOfferConfig()).enabled).toBe(true)
      // Not stuck on the fallback for the full TTL: the next read happens soon.
      vi.advanceTimersByTime(6_000)
      mockSetting({ key: WELCOME_OFFER_ENABLED_KEY, value: false })
      expect((await getWelcomeOfferConfig()).enabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("caches the answer until invalidated", async () => {
    mockSetting({ key: WELCOME_OFFER_ENABLED_KEY, value: true })
    await getWelcomeOfferConfig()
    await getWelcomeOfferConfig()
    expect(supabase.from).toHaveBeenCalledTimes(1)
    invalidateWelcomeOfferConfigCache()
    await getWelcomeOfferConfig()
    expect(supabase.from).toHaveBeenCalledTimes(2)
  })
})

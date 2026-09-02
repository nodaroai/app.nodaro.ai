import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { getConsentConfig, invalidateConsentConfigCache, CONSENT_CONFIG_DEFAULTS } from "../consent-config.js"
import { supabase } from "../../../lib/supabase.js"

function mockSettings(rows: Array<{ key: string; value: unknown }> | null, error: unknown = null) {
  const inMock = vi.fn().mockResolvedValue({ data: rows, error })
  const selectMock = vi.fn().mockReturnValue({ in: inMock })
  vi.mocked(supabase.from).mockReturnValue({ select: selectMock } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  invalidateConsentConfigCache()
})

describe("getConsentConfig", () => {
  it("returns the defaults (disabled) when no rows exist", async () => {
    mockSettings([])
    const cfg = await getConsentConfig()
    expect(cfg).toEqual(CONSENT_CONFIG_DEFAULTS)
    expect(cfg.enabled).toBe(false)
  })

  it("stays disabled on a DB error and never throws", async () => {
    mockSettings(null, { message: "boom" })
    const cfg = await getConsentConfig()
    expect(cfg.enabled).toBe(false)
    expect(cfg.maxAsks).toBe(5)
  })

  it("parses valid overrides", async () => {
    mockSettings([
      { key: "consent_enabled", value: true },
      { key: "consent_cadence_hours", value: 48 },
      { key: "consent_max_asks", value: 3 },
      { key: "consent_withdrawn_cadence_hours", value: 168 },
      { key: "consent_login_definition", value: "app_open" },
      { key: "consent_text", value: "Custom copy" },
      { key: "consent_version", value: 2 },
    ])
    const cfg = await getConsentConfig()
    expect(cfg).toEqual({
      enabled: true,
      cadenceHours: 48,
      maxAsks: 3,
      withdrawnCadenceHours: 168,
      loginDefinition: "app_open",
      text: "Custom copy",
      version: 2,
    })
  })

  it("ignores malformed values and keeps the default for each", async () => {
    mockSettings([
      { key: "consent_enabled", value: "yes" },
      { key: "consent_max_asks", value: 0 },
      { key: "consent_cadence_hours", value: -5 },
      { key: "consent_login_definition", value: "weekly" },
      { key: "consent_text", value: "   " },
      { key: "consent_version", value: 1.5 },
    ])
    const cfg = await getConsentConfig()
    expect(cfg.enabled).toBe(false)
    expect(cfg.maxAsks).toBe(5)
    expect(cfg.cadenceHours).toBe(24)
    expect(cfg.loginDefinition).toBe("session")
    expect(cfg.text).toBe(CONSENT_CONFIG_DEFAULTS.text)
    expect(cfg.version).toBe(1)
  })

  it("caches within the TTL and re-reads after invalidate", async () => {
    mockSettings([{ key: "consent_enabled", value: true }])
    await getConsentConfig()
    await getConsentConfig()
    expect(supabase.from).toHaveBeenCalledTimes(1)
    invalidateConsentConfigCache()
    await getConsentConfig()
    expect(supabase.from).toHaveBeenCalledTimes(2)
  })
})

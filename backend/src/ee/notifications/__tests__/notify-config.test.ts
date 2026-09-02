import { describe, it, expect, vi, beforeEach } from "vitest"

// Mutable holder the mocked query resolves from, so each test can stage rows.
const state = { rows: [] as Array<{ key: string; value: unknown }>, error: null as unknown }

vi.mock("@/lib/supabase.js", () => {
  const inFn = vi.fn(async () => ({ data: state.rows, error: state.error }))
  const select = vi.fn(() => ({ in: inFn }))
  const from = vi.fn(() => ({ select }))
  return { supabase: { from } }
})

import { getNotifyConfig, invalidateNotifyConfigCache, NOTIFY_CONFIG_DEFAULTS } from "../notify-config.js"
import { supabase } from "@/lib/supabase.js"

const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  invalidateNotifyConfigCache()
  state.rows = []
  state.error = null
})

describe("getNotifyConfig", () => {
  it("returns dormant defaults when no rows exist", async () => {
    expect(await getNotifyConfig()).toEqual(NOTIFY_CONFIG_DEFAULTS)
  })

  it("returns defaults when the read errors (e.g. missing table on a fresh install)", async () => {
    state.error = { message: "relation \"app_settings\" does not exist" }
    expect(await getNotifyConfig()).toEqual(NOTIFY_CONFIG_DEFAULTS)
  })

  it("applies stored values and trims the webhook URL", async () => {
    state.rows = [
      { key: "notify_digest_enabled", value: false },
      { key: "notify_digest_hour", value: 20 },
      { key: "notify_milestones_enabled", value: false },
      { key: "notify_every_signup_enabled", value: true },
      { key: "notify_slack_webhook_url", value: "  https://hooks.slack.com/services/x  " },
    ]
    const cfg = await getNotifyConfig()
    expect(cfg.digestEnabled).toBe(false)
    expect(cfg.digestHour).toBe(20)
    expect(cfg.milestonesEnabled).toBe(false)
    expect(cfg.everySignupEnabled).toBe(true)
    expect(cfg.slackWebhookUrl).toBe("https://hooks.slack.com/services/x")
  })

  it("ignores an out-of-range hour and wrong-typed values (falls back to defaults)", async () => {
    state.rows = [
      { key: "notify_digest_hour", value: 25 }, // outside 0-23
      { key: "notify_digest_enabled", value: "yes" }, // not a boolean
    ]
    const cfg = await getNotifyConfig()
    expect(cfg.digestHour).toBe(NOTIFY_CONFIG_DEFAULTS.digestHour)
    expect(cfg.digestEnabled).toBe(NOTIFY_CONFIG_DEFAULTS.digestEnabled)
  })

  it("serves the second call from cache within the TTL (one query)", async () => {
    await getNotifyConfig()
    await getNotifyConfig()
    expect(fromMock).toHaveBeenCalledTimes(1)
  })
})

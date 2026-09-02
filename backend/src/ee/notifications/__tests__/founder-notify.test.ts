import { describe, it, expect, vi, beforeEach } from "vitest"

// A chainable stub whose terminal methods (maybeSingle / single) resolve to a
// canned profile row — enough for userEmail() inside the milestone guards.
vi.mock("@/lib/supabase.js", () => {
  const chain: Record<string, unknown> = {}
  for (const m of ["from", "select", "eq", "not", "gt", "gte", "lt", "lte", "in", "order", "limit"]) {
    chain[m] = vi.fn(() => chain)
  }
  chain.maybeSingle = vi.fn(async () => ({ data: { email: "user@example.com" }, error: null }))
  chain.single = vi.fn(async () => ({ data: { email: "user@example.com" }, error: null }))
  return { supabase: chain }
})
vi.mock("@/ee/notifications/notify-config.js", () => ({
  getNotifyConfig: vi.fn(),
  readNotifyState: vi.fn(async () => null),
  writeNotifyState: vi.fn(async () => undefined),
}))
vi.mock("@/ee/notifications/slack-client.js", () => ({
  sendSlack: vi.fn(async () => ({ ok: true })),
}))
vi.mock("@/ee/notifications/signup-product.js", () => ({
  signupProduct: vi.fn(async () => "app"),
  signupProductsFor: vi.fn(async () => new Map()),
}))
// PUBLIC_URL drives the single-sender guard; default "" = this instance sends.
vi.mock("@/lib/config.js", () => ({ config: { PUBLIC_URL: "" } }))

import {
  israelParts,
  startOfIsraelDayUtc,
  notifyPaidConversion,
  notifyCancellation,
  isStandbySender,
} from "../founder-notify.js"
import { getNotifyConfig } from "../notify-config.js"
import { sendSlack } from "../slack-client.js"
import { config } from "../../../lib/config.js"

function setPublicUrl(url: string) {
  ;(config as { PUBLIC_URL: string }).PUBLIC_URL = url
}

const CONFIG_ON = {
  digestEnabled: true,
  digestHour: 8,
  milestonesEnabled: true,
  everySignupEnabled: false,
  slackWebhookUrl: "https://hooks.slack.com/services/T0/B0/secret",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getNotifyConfig).mockResolvedValue({ ...CONFIG_ON })
  vi.mocked(sendSlack).mockResolvedValue({ ok: true })
  setPublicUrl("") // default: this instance is the sender
})

describe("isStandbySender — single-sender guard (shared DB)", () => {
  it("sends when PUBLIC_URL is empty (self-host / local)", () => {
    setPublicUrl("")
    expect(isStandbySender()).toBe(false)
  })

  it("stands by on the staging host (next.nodaro.ai)", () => {
    setPublicUrl("https://next.nodaro.ai")
    expect(isStandbySender()).toBe(true)
  })

  it("sends on the production host (app.nodaro.ai)", () => {
    setPublicUrl("https://app.nodaro.ai")
    expect(isStandbySender()).toBe(false)
  })

  it("sends on an arbitrary self-host domain", () => {
    setPublicUrl("https://nodaro.acme.internal")
    expect(isStandbySender()).toBe(false)
  })

  it("a standby instance does not send milestone alerts", async () => {
    setPublicUrl("https://next.nodaro.ai")
    await notifyPaidConversion("u1", "free", "pro")
    await notifyCancellation("u1", "pro")
    expect(sendSlack).not.toHaveBeenCalled()
  })
})

describe("israelParts — DST-safe wall clock", () => {
  it("reads UTC+3 (IDT) in summer", () => {
    const p = israelParts(new Date("2026-07-01T00:00:00Z"))
    expect(p.date).toBe("2026-07-01")
    expect(p.hour).toBe(3)
  })

  it("reads UTC+2 (IST) in winter — same code, different offset", () => {
    const p = israelParts(new Date("2026-01-01T00:00:00Z"))
    expect(p.date).toBe("2026-01-01")
    expect(p.hour).toBe(2)
  })
})

describe("startOfIsraelDayUtc", () => {
  it("returns the UTC instant of the most recent Israel midnight (summer)", () => {
    // 2026-07-01T12:00Z == 15:00 IDT → Israel midnight was 2026-07-01T00:00 IDT == 2026-06-30T21:00Z
    expect(startOfIsraelDayUtc(new Date("2026-07-01T12:00:00Z")).toISOString()).toBe("2026-06-30T21:00:00.000Z")
  })

  it("returns the UTC instant of the most recent Israel midnight (winter)", () => {
    // 2026-01-01T12:00Z == 14:00 IST → Israel midnight was 2026-01-01T00:00 IST == 2025-12-31T22:00Z
    expect(startOfIsraelDayUtc(new Date("2026-01-01T12:00:00Z")).toISOString()).toBe("2025-12-31T22:00:00.000Z")
  })
})

describe("notifyPaidConversion — fires only on a real free→paid transition", () => {
  it("fires when prior tier is free", async () => {
    await notifyPaidConversion("u1", "free", "pro")
    expect(sendSlack).toHaveBeenCalledOnce()
  })

  it("fires when prior tier is null (treated as free)", async () => {
    await notifyPaidConversion("u1", null, "basic")
    expect(sendSlack).toHaveBeenCalledOnce()
  })

  it("does NOT fire on a paid→paid upgrade", async () => {
    await notifyPaidConversion("u1", "basic", "pro")
    expect(sendSlack).not.toHaveBeenCalled()
  })

  it("does NOT fire when the new tier is still free", async () => {
    await notifyPaidConversion("u1", "free", "free")
    expect(sendSlack).not.toHaveBeenCalled()
  })

  it("does NOT fire when milestones are disabled", async () => {
    vi.mocked(getNotifyConfig).mockResolvedValue({ ...CONFIG_ON, milestonesEnabled: false })
    await notifyPaidConversion("u1", "free", "pro")
    expect(sendSlack).not.toHaveBeenCalled()
  })

  it("does NOT fire when no webhook is configured", async () => {
    vi.mocked(getNotifyConfig).mockResolvedValue({ ...CONFIG_ON, slackWebhookUrl: "" })
    await notifyPaidConversion("u1", "free", "pro")
    expect(sendSlack).not.toHaveBeenCalled()
  })
})

describe("notifyCancellation — fires only when the user was actually paid", () => {
  it("fires when the prior tier was paid", async () => {
    await notifyCancellation("u1", "pro")
    expect(sendSlack).toHaveBeenCalledOnce()
  })

  it("does NOT fire on a free-tier ghost cancel", async () => {
    await notifyCancellation("u1", "free")
    expect(sendSlack).not.toHaveBeenCalled()
  })

  it("does NOT fire when prior tier is null", async () => {
    await notifyCancellation("u1", null)
    expect(sendSlack).not.toHaveBeenCalled()
  })

  it("does NOT fire when the userId could not be resolved", async () => {
    await notifyCancellation(null, "pro")
    expect(sendSlack).not.toHaveBeenCalled()
  })

  it("uses distinct 'scheduled to cancel' wording when scheduled=true", async () => {
    await notifyCancellation("u1", "pro", true)
    expect(sendSlack).toHaveBeenCalledOnce()
    const msg = vi.mocked(sendSlack).mock.calls[0][1] as { text: string }
    expect(msg.text).toContain("Scheduled to cancel")
  })
})

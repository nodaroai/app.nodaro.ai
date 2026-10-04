/**
 * LTX 2.3 Pro Extend — the workflow run's reservation.
 *
 * `computeLtxExtendCreditOverride` must reserve what the route's guard
 * charges for the same request: the per-second row × the seconds the payload
 * sends, marked up once at the row's margin (the guard's own
 * `applyServiceMarkup`). The payload builder sends `ltxExtendDurationSec`'s
 * reading, so the seconds priced are the seconds rendered.
 *
 * Harness mirrors edit-video-pro-override.test.ts: node-executor pulls in
 * supabase/queue/credits/config at module load, so each is stubbed just to
 * import the function.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockGetAppSettings } = vi.hoisted(() => ({ mockGetAppSettings: vi.fn() }))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000 },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: vi.fn(), reserveCredits: vi.fn() },
  getModelCreditBaseCost: vi.fn(async (id: string) => ({
    creditCost: id === "ltx-2.3-pro-extend:per-second" ? 40 : 999,
    isEnabled: true,
    tierRestriction: null,
  })),
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: mockGetAppSettings }))

import { computeLtxExtendCreditOverride } from "../node-executor.js"
import { buildPayload } from "../payload-builder.js"
import { applyServiceMarkup } from "../../../ee/billing/service-margin.js"

const ID = "ltx-2.3-pro-extend:per-second"

describe("computeLtxExtendCreditOverride", () => {
  beforeEach(() => {
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 10 })
  })

  it.each([
    [2, 88],
    [6, 264],
    [20, 880],
  ])("%i seconds → the per-second row × seconds, marked up once (%i)", async (seconds, credits) => {
    const payload = { provider: "ltx-2.3-pro", duration: seconds }
    expect(await computeLtxExtendCreditOverride("extend-video", payload, ID)).toBe(credits)
  })

  it("equals what the route's guard charges for the same request", async () => {
    const settings = { cost_markup_percent: 10 }
    for (const seconds of [1, 7, 13, 20]) {
      const guard = applyServiceMarkup(40 * seconds, settings as never, ID)
      expect(await computeLtxExtendCreditOverride("extend-video", { provider: "ltx-2.3-pro", duration: seconds }, ID)).toBe(guard)
    }
  })

  it("prices the seconds the workflow payload sends — the model's default 6 when the node has none", async () => {
    const built = buildPayload({ id: "n1", type: "extend-video", data: { provider: "ltx-2.3-pro" } }, "job-1", {
      videoUrl: "https://cdn.example.com/a.mp4",
    })
    expect(built.payload.duration).toBe(6)
    expect(await computeLtxExtendCreditOverride(built.jobName, built.payload, built.modelIdentifier)).toBe(264)
  })

  it("leaves every other job alone", async () => {
    expect(await computeLtxExtendCreditOverride("extend-video", { provider: "veo-extend", duration: 8 }, "veo-extend")).toBeUndefined()
    expect(await computeLtxExtendCreditOverride("video-retake", { provider: "ltx-2.3-pro", duration: 8 }, ID)).toBeUndefined()
  })
})

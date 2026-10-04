/**
 * LTX 2.3 Pro Retake — the workflow run's reservation.
 *
 * `computeLtxRetakeCreditOverride` must reserve what the route's guard charges
 * for the same request: the per-second row × the replaced window the payload
 * sends (at least 2 s, may be fractional), rounded up to a whole credit and
 * marked up once at the row's margin. Before it, a workflow retake reserved
 * the flat `video-retake` row whatever the window.
 *
 * Harness mirrors ltx-extend-override.test.ts.
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
    creditCost: id === "ltx-2.3-pro-retake:per-second" ? 40 : 999,
    isEnabled: true,
    tierRestriction: null,
  })),
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: mockGetAppSettings }))

import { computeLtxRetakeCreditOverride } from "../node-executor.js"
import { buildPayload } from "../payload-builder.js"
import { applyServiceMarkup } from "../../../ee/billing/service-margin.js"

const ID = "ltx-2.3-pro-retake:per-second"

describe("computeLtxRetakeCreditOverride", () => {
  beforeEach(() => {
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 10 })
  })

  it.each([
    [2, 88],
    [2.5, 110],
    [6, 264],
  ])("a %s s window → ceil(per-second row × seconds), marked up once (%i)", async (seconds, credits) => {
    expect(await computeLtxRetakeCreditOverride("video-retake", { retake_duration: seconds }, ID)).toBe(credits)
  })

  it("equals what the route's guard charges for the same window", async () => {
    const settings = { cost_markup_percent: 10 }
    for (const seconds of [2, 3.3, 7.25, 12]) {
      const guard = applyServiceMarkup(Math.ceil(40 * seconds), settings as never, ID)
      expect(await computeLtxRetakeCreditOverride("video-retake", { retake_duration: seconds }, ID)).toBe(guard)
    }
  })

  it("reserves on the per-second row and prices the window the workflow payload sends", async () => {
    const node = { id: "n1", type: "video-retake", data: { retakeDuration: "4", retakeStartTime: 1, retakeMode: "replace_video" } }
    const built = buildPayload(node, "job-1", { videoUrl: "https://cdn.example.com/a.mp4" })
    expect(built.modelIdentifier).toBe(ID)
    expect(built.payload.retake_duration).toBe(4)
    expect(await computeLtxRetakeCreditOverride(built.jobName, built.payload, built.modelIdentifier)).toBe(176)
  })

  it("a node with no window is priced and sent as the 2-second minimum", async () => {
    const built = buildPayload({ id: "n1", type: "video-retake", data: {} }, "job-1", {
      videoUrl: "https://cdn.example.com/a.mp4",
    })
    expect(built.payload.retake_duration).toBe(2)
    expect(await computeLtxRetakeCreditOverride(built.jobName, built.payload, built.modelIdentifier)).toBe(88)
  })

  it("leaves every other job alone", async () => {
    expect(await computeLtxRetakeCreditOverride("extend-video", { retake_duration: 4 }, ID)).toBeUndefined()
  })
})

/**
 * Motion Transfer on Kling 3.0 at 720p — the workflow run's reservation
 * (decided 2026-11-18).
 *
 * The run stamps the measured driving video (`stampMotionTransferInput`,
 * tested in lib/__tests__/motion-transfer-input.test.ts) and
 * `computeMotionTransferRateCreditOverride` reserves the four-second row × the
 * billed seconds ÷ 4, rounded up once, marked up once — what the route's guard
 * holds for the same video. Every other model and size reserves its stamped
 * row (no override). Harness mirrors lip-sync-rate-override.test.ts.
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
    creditCost: id === "kling-3.0-motion:720p:per-4s" ? 228 : 999,
    isEnabled: true,
    tierRestriction: null,
  })),
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: mockGetAppSettings }))

import { computeMotionTransferRateCreditOverride } from "../node-executor.js"
import type { FastifyRequest } from "fastify"
import { motionTransferComputeCredits } from "../../../routes/motion-transfer.js"
import { applyServiceMarkup } from "../../../ee/billing/service-margin.js"

const ID = "kling-3.0-motion:720p:per-4s"
const SETTINGS = { cost_markup_percent: 10 }

describe("computeMotionTransferRateCreditOverride", () => {
  beforeEach(() => {
    mockGetAppSettings.mockResolvedValue(SETTINGS)
  })

  it.each([
    [3, 171],
    [10, 570],
  ])("%i billed seconds: base %i, marked up once", async (seconds, base) => {
    const payload = { provider: "kling-3.0", resolution: "720p", motionTransferBilledSeconds: seconds }
    expect(await computeMotionTransferRateCreditOverride("motion-transfer", payload, ID)).toBe(applyServiceMarkup(base, SETTINGS as never, ID))
  })

  it("is exactly what the route's guard holds for the same measured video (computeCredits, marked up once)", async () => {
    for (const seconds of [3, 4, 7, 10, 30]) {
      // The measure the route's measuring step keeps on the request (server-side, never the body).
      const req = { requestMeasures: { motionTransfer: { measuredSec: seconds, billedSeconds: seconds, creditId: ID, units: seconds / 4 } } } as unknown as FastifyRequest
      const routeBase = await motionTransferComputeCredits({ provider: "kling-3.0" }, req)
      const routeHold = applyServiceMarkup(routeBase!, SETTINGS as never, ID)
      const payload = { provider: "kling-3.0", resolution: "720p", motionTransferBilledSeconds: seconds }
      expect(await computeMotionTransferRateCreditOverride("motion-transfer", payload, ID)).toBe(routeHold)
    }
  })

  it("no override for a model or size priced by its row, nor for another job", async () => {
    expect(await computeMotionTransferRateCreditOverride("motion-transfer", { provider: "kling-3.0", resolution: "1080p", motionTransferBilledSeconds: 10 }, "kling-3.0-motion:1080p:10s")).toBeUndefined()
    expect(await computeMotionTransferRateCreditOverride("motion-transfer", { provider: "kling", resolution: "720p", motionTransferBilledSeconds: 10 }, "motion-transfer:10s")).toBeUndefined()
    expect(await computeMotionTransferRateCreditOverride("lip-sync", { provider: "kling-3.0", motionTransferBilledSeconds: 10 }, ID)).toBeUndefined()
  })
})

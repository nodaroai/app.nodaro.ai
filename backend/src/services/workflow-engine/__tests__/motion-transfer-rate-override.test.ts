/**
 * Motion Transfer — the workflow run's reservation (decided 2026-11-18).
 *
 * The run stamps the driving video's length, the row the floor rule chose and
 * its units (`stampMotionTransferInput`, tested in
 * lib/__tests__/motion-transfer-input.test.ts), and
 * `computeMotionTransferRateCreditOverride` reserves a rate row × the stamped
 * units, rounded up once, marked up once at that row — what the route's guard
 * holds for the same video. A run stamped at a Wan Animate floor row reserves
 * that row (no override). Harness mirrors lip-sync-rate-override.test.ts.
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
    creditCost: ({ "kling-3.0-motion:720p:per-4s": 228, "motion-transfer:720p:per-4s": 126, "wan-animate-replace:720p:per-4s": 125 } as Record<string, number>)[id] ?? 999,
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

  /** A payload as the stamp leaves it for a run charged at the rate row `id`. */
  const stamped = (provider: string, resolution: string, seconds: number, id = ID) => ({
    provider, resolution, motionTransferBilledSeconds: seconds, bucketKey: id, motionTransferUnits: seconds / 4,
  })

  it.each([
    [3, 171],
    [10, 570],
  ])("%i billed seconds: base %i, marked up once", async (seconds, base) => {
    expect(await computeMotionTransferRateCreditOverride("motion-transfer", stamped("kling-3.0", "720p", seconds), ID)).toBe(applyServiceMarkup(base, SETTINGS as never, ID))
  })

  it("Kling 2.6 at 720p, 10 s: ceil(126 × 10 / 4) = 315 base, marked up once", async () => {
    const id = "motion-transfer:720p:per-4s"
    expect(await computeMotionTransferRateCreditOverride("motion-transfer", stamped("kling", "720p", 10, id), id)).toBe(applyServiceMarkup(315, SETTINGS as never, id))
  })

  it("is exactly what the route's guard holds for the same video (computeCredits, marked up once)", async () => {
    for (const [provider, resolution, id] of [["kling-3.0", "720p", ID], ["kling", "720p", "motion-transfer:720p:per-4s"], ["wan-animate-replace", "720p", "wan-animate-replace:720p:per-4s"]] as const) {
      for (const seconds of [3, 4, 7, 10, 30]) {
        // The measure the route's step keeps on the request (server-side, never the body).
        const req = { requestMeasures: { motionTransfer: { measuredSec: seconds, billedSeconds: seconds, creditId: id, units: seconds / 4 } } } as unknown as FastifyRequest
        const routeBase = await motionTransferComputeCredits({ provider }, req)
        const routeHold = applyServiceMarkup(routeBase!, SETTINGS as never, id)
        expect(await computeMotionTransferRateCreditOverride("motion-transfer", stamped(provider, resolution, seconds, id), id)).toBe(routeHold)
      }
    }
  })

  it("a run stamped at a Wan Animate floor row reserves that row, as the route's guard does (no per-second base)", async () => {
    const floor = "wan-animate-replace:720p"
    const payload = { provider: "wan-animate-replace", resolution: "720p", motionTransferBilledSeconds: 3, bucketKey: floor }
    expect(await computeMotionTransferRateCreditOverride("motion-transfer", payload, floor)).toBeUndefined()
    const req = { requestMeasures: { motionTransfer: { measuredSec: 3, billedSeconds: 3, creditId: floor } } } as unknown as FastifyRequest
    expect(await motionTransferComputeCredits({ provider: "wan-animate-replace" }, req)).toBeUndefined()
  })

  it("marks up at the row it reserves, whatever margin that row's service carries", async () => {
    const id = "wan-animate-replace:720p:per-4s"
    const margins = { cost_markup_percent: 10, service_margin_percent: { "wan-animate-replace:720p:per-4s": 40 } }
    mockGetAppSettings.mockResolvedValue(margins)
    expect(await computeMotionTransferRateCreditOverride("motion-transfer", stamped("wan-animate-replace", "720p", 30, id), id)).toBe(applyServiceMarkup(938, margins as never, id))
    expect(applyServiceMarkup(938, margins as never, id)).toBe(Math.ceil((938 * 140) / 100))
  })

  it("no override for another job", async () => {
    expect(await computeMotionTransferRateCreditOverride("lip-sync", stamped("kling-3.0", "720p", 10), ID)).toBeUndefined()
  })
})

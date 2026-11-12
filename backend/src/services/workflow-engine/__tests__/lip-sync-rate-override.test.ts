/**
 * OmniHuman 2.0 — the workflow run's reservation (decided 2026-11-11).
 *
 * The payload builder reserves on the model's one-second row and drops the
 * levers it does not take; the run stamps the measured audio
 * (`stampLipSyncInputs`, tested in lib/__tests__/lip-sync-inputs.test.ts) and
 * `computeLipSyncRateCreditOverride` reserves the row × the billed seconds,
 * marked up once — what the route's guard charges for the same audio.
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
    creditCost: id === "omnihuman-2-0:per-second" ? 35 : 999,
    isEnabled: true,
    tierRestriction: null,
  })),
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: mockGetAppSettings }))

import { computeLipSyncRateCreditOverride } from "../node-executor.js"
import { buildPayload } from "../payload-builder.js"
import { lipSyncComputeCredits } from "../../../routes/lip-sync.js"
import { applyServiceMarkup } from "../../../ee/billing/service-margin.js"

const ID = "omnihuman-2-0:per-second"
const SETTINGS = { cost_markup_percent: 10 }

describe("computeLipSyncRateCreditOverride", () => {
  beforeEach(() => {
    mockGetAppSettings.mockResolvedValue(SETTINGS)
  })

  it.each([
    [4, 154],
    [10, 385],
    [11, 424],
    [15, 578],
    [60, 2310],
    [300, 11550],
  ])("%i billed seconds → %i credits at a 10%% markup", async (seconds, credits) => {
    expect(await computeLipSyncRateCreditOverride("lip-sync", { provider: "omnihuman-2-0", lipSyncBilledSeconds: seconds }, ID)).toBe(credits)
  })

  it("is exactly what the route's guard holds for the same measured audio (computeCredits, marked up once)", async () => {
    for (const seconds of [4, 7, 11, 299, 300]) {
      const routeBase = await lipSyncComputeCredits({ provider: "omnihuman-2-0", __lipSyncBilledSeconds: seconds })
      const routeHold = applyServiceMarkup(routeBase!, SETTINGS as never, ID)
      expect(await computeLipSyncRateCreditOverride("lip-sync", { provider: "omnihuman-2-0", lipSyncBilledSeconds: seconds }, ID)).toBe(routeHold)
    }
  })

  it("a rate run that was never measured is refused, never priced at a guess — on both lanes", async () => {
    await expect(computeLipSyncRateCreditOverride("lip-sync", { provider: "omnihuman-2-0", audioDurationSec: 10 }, ID)).rejects.toThrow(/measured audio/)
    await expect(lipSyncComputeCredits({ provider: "omnihuman-2-0", audioDurationSec: 10 })).rejects.toThrow(/measured audio/)
  })

  it("leaves every other model and job alone (their rows price them as before)", async () => {
    expect(await computeLipSyncRateCreditOverride("lip-sync", { provider: "omnihuman-1-5", audioDurationSec: 10 }, "omnihuman-1-5:15s")).toBeUndefined()
    expect(await computeLipSyncRateCreditOverride("lip-sync", { provider: "kling-avatar" }, "kling-avatar")).toBeUndefined()
    expect(await computeLipSyncRateCreditOverride("image-to-video", { provider: "omnihuman-2-0", lipSyncBilledSeconds: 4 }, ID)).toBeUndefined()
    expect(await lipSyncComputeCredits({ provider: "omnihuman-1-5", audioDurationSec: 10 })).toBeUndefined()
    expect(await lipSyncComputeCredits({})).toBeUndefined()
  })
})

describe("the workflow payload for OmniHuman 2.0", () => {
  it("reserves on the one-second row and drops 1.5's resolution, fast mode and seed", () => {
    const built = buildPayload(
      { id: "n1", type: "lip-sync", data: { provider: "omnihuman-2-0", resolution: "1080p", fastMode: true, seed: 42, audioDurationSec: 3, prompt: "hello" } },
      "job-1",
      { imageUrl: "https://cdn.example.com/i.png", audioUrl: "https://cdn.example.com/a.mp3" },
    )
    expect(built.modelIdentifier).toBe(ID)
    expect(built.payload).toMatchObject({ provider: "omnihuman-2-0", imageUrl: "https://cdn.example.com/i.png", audioUrl: "https://cdn.example.com/a.mp3", prompt: "hello" })
    expect(built.payload.resolution).toBeUndefined()
    expect(built.payload.seed).toBeUndefined()
    expect(built.payload.fastMode).toBeUndefined()
    // The node's own length is never the price: the run measures the audio (stampLipSyncInputs).
    expect(built.payload.audioDurationSec).toBeUndefined()
  })

  it("leaves 1.5 exactly as it was (its bucket id, its levers)", () => {
    const built = buildPayload(
      { id: "n1", type: "lip-sync", data: { provider: "omnihuman-1-5", resolution: "1080p", seed: 42, audioDurationSec: 25 } },
      "job-1",
      { imageUrl: "https://cdn.example.com/i.png", audioUrl: "https://cdn.example.com/a.mp3" },
    )
    expect(built.modelIdentifier).toBe("omnihuman-1-5:30s")
    expect(built.payload).toMatchObject({ resolution: "1080p", seed: 42, audioDurationSec: 25 })
  })
})

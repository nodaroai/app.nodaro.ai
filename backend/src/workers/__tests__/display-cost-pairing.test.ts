import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A job row's `display_cost` is its own `provider_cost` with the markup applied
 * once, whatever a caller hands in (lib/job-cost-columns.ts). Through the REAL
 * completion and failure funnels; only the jobs row and the settings are
 * stubbed. The markup below is made up.
 */

const MARKUP = 25

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  settings: vi.fn(),
  readFailed: vi.fn(),
}))

vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as { config: Record<string, unknown> }
  return { ...orig, hasCredits: () => false }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      update: (row: Record<string, unknown>) => {
        mocks.update(row)
        return { eq: () => ({ in: () => ({ select: async () => ({ data: [{ id: "job-1", usage_log_id: null }], error: null }) }) }) }
      },
    }),
    rpc: vi.fn(),
  },
}))

vi.mock("@/lib/app-settings.js", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getAppSettings: mocks.settings,
  settingsReadFailed: mocks.readFailed,
}))

import { markJobCompletedDetailed } from "../shared.js"
import { markJobFailedDetailed } from "../../lib/job-failure.js"
import { jobCostColumns, jobCostColumnsAt, withPairedDisplayCost } from "../../lib/job-cost-columns.js"
import { seedance25CostUsd } from "../../providers/kie/seedance-cost.js"
import { KIE_VIDEO_MODELS } from "../../providers/kie/models.js"

const written = () => mocks.update.mock.calls[0]![0] as Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  mocks.settings.mockResolvedValue({ cost_markup_percent: MARKUP })
  mocks.readFailed.mockReturnValue(false)
})

describe("display_cost is derived from the row's own provider_cost", () => {
  it("a 23 s Seedance 2.5 run: display_cost is the measured cost × markup, not the adapter's figure the router marked up", async () => {
    const measured = seedance25CostUsd({ resolution: "720p", draft: false, hasVideoRef: false, outputSec: 23, inputSec: 0 })
    const adapterFigure = KIE_VIDEO_MODELS["seedance-2-5"]!.cost
    const staleDisplay = adapterFigure * (1 + MARKUP / 100)

    await markJobCompletedDetailed("job-1", { output_data: { videoUrl: "https://r2/x.mp4" }, provider_cost: measured, display_cost: staleDisplay })

    expect(written().provider_cost).toBe(measured)
    expect(written().display_cost).toBeCloseTo(measured * (1 + MARKUP / 100), 12)
    expect(written().display_cost).not.toBe(staleDisplay)
  })

  it("the same pair for every length of a per-second model: display_cost / provider_cost is the markup", async () => {
    for (const outputSec of [4, 8, 15, 23]) {
      mocks.update.mockClear()
      const cost = seedance25CostUsd({ resolution: "1080p", draft: false, hasVideoRef: false, outputSec, inputSec: 0 })
      await markJobCompletedDetailed("job-1", { output_data: {}, provider_cost: cost })
      expect((written().display_cost as number) / (written().provider_cost as number)).toBeCloseTo(1 + MARKUP / 100, 12)
    }
  })

  it("a display_cost with no provider_cost beside it is dropped (it has no source)", async () => {
    await markJobCompletedDetailed("job-1", { output_data: {}, display_cost: 9 })
    expect(written()).not.toHaveProperty("display_cost")
    expect(written()).not.toHaveProperty("provider_cost")
  })

  it("a null provider_cost writes a null display_cost", async () => {
    await markJobCompletedDetailed("job-1", { output_data: {}, provider_cost: null })
    expect(written()).toMatchObject({ provider_cost: null, display_cost: null })
  })

  it("settings that could not be read (the flagged stand-in defaults) write a null display figure, never one at a guessed markup", async () => {
    // getAppSettings does not throw on a failed read: it hands out defaults
    // with markup 0 that settingsReadFailed flags.
    const standIn = { cost_markup_percent: 0 }
    mocks.settings.mockResolvedValue(standIn)
    mocks.readFailed.mockImplementation((s: unknown) => s === standIn)
    await markJobCompletedDetailed("job-1", { output_data: {}, provider_cost: 2, display_cost: 2.5 })
    expect(written().provider_cost).toBe(2)
    // Null, not omitted: an earlier pair cannot survive beside the new cost.
    expect(written()).toHaveProperty("display_cost", null)
  })

  it("a settings read that throws is treated the same", async () => {
    mocks.settings.mockRejectedValueOnce(new Error("down"))
    await markJobCompletedDetailed("job-1", { output_data: {}, provider_cost: 2 })
    expect(written()).toMatchObject({ provider_cost: 2, display_cost: null })
  })

  it("a failed run the provider billed gets the same pair", async () => {
    await markJobFailedDetailed("job-1", { error_message: "boom", extra: { provider_cost: 0.4, display_cost: 0.1 } })
    expect(written().provider_cost).toBe(0.4)
    expect(written().display_cost).toBeCloseTo(0.5, 12)
  })

  it("a failure with no cost writes neither", async () => {
    await markJobFailedDetailed("job-1", { error_message: "boom", extra: { provider: "kie" } })
    expect(written()).not.toHaveProperty("provider_cost")
    expect(written()).not.toHaveProperty("display_cost")
  })
})

describe("jobCostColumns", () => {
  it("pairs a cost, writes both as null for null, and nothing for an unknown cost", async () => {
    expect(await jobCostColumns(2)).toEqual({ provider_cost: 2, display_cost: 2.5 })
    expect(await jobCostColumns(0)).toEqual({ provider_cost: 0, display_cost: 0 })
    expect(await jobCostColumns(null)).toEqual({ provider_cost: null, display_cost: null })
    expect(await jobCostColumns(undefined)).toEqual({})
    expect(await jobCostColumns(Number.NaN)).toEqual({})
    expect(jobCostColumnsAt(4, 0)).toEqual({ provider_cost: 4, display_cost: 4 })
    expect(jobCostColumnsAt(4, undefined)).toEqual({ provider_cost: 4, display_cost: null })
  })

  it("returns fields that carry neither key as the same object", async () => {
    const fields = { output_data: {} }
    expect(await withPairedDisplayCost(fields)).toBe(fields)
  })
})

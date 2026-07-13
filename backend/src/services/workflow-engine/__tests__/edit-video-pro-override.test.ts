/**
 * edit-video-pro credit override — Task 11.
 *
 * `computeEditVideoProCreditOverride` is the DAG-path money gate for the
 * edit-video-pro node: it mirrors `computeGenerateVideoProCreditOverride`
 * (same file) but PROBES the source video (via the ee pricing helper) instead
 * of trusting a client-declared duration, and additionally gates on
 * `payload.mode === "replace"` (edit-mode reserves nothing in v1 — "edit" is
 * reserved for a future version) and can THROW when the requested span is
 * beyond the probed source's actual length.
 *
 * Mocking strategy mirrors `generate-video-pro-dispatch.test.ts`'s harness:
 * node-executor.ts pulls in supabase/queue/render-queue/credits/config/
 * app-settings at module load time, so all of those need a stub just to
 * import `computeEditVideoProCreditOverride` — even though these tests never
 * call `executeNode()` and never touch most of those mocks directly. The ee
 * pricing helper (`edit-video-pro-credits.js`) is mocked because it's loaded
 * via DYNAMIC `import()` inside the SUT (the core/ee boundary escape hatch —
 * mocking the module id intercepts the dynamic import too).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockGetAppSettings, mockComputeEvpPricing } = vi.hoisted(() => ({
  mockGetAppSettings: vi.fn(),
  mockComputeEvpPricing: vi.fn(),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000 },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => {
  const eqFn = vi.fn().mockResolvedValue({ error: null })
  const updateFn = vi.fn().mockReturnValue({ eq: eqFn })
  const deleteEqFn = vi.fn().mockResolvedValue({ error: null })
  const deleteFn = vi.fn().mockReturnValue({ eq: deleteEqFn })
  const singleFn = vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null })
  const selectFn = vi.fn().mockReturnValue({ single: singleFn })
  const insertFn = vi.fn().mockReturnValue({ select: selectFn })
  return {
    supabase: {
      from: vi.fn().mockReturnValue({
        insert: insertFn,
        update: updateFn,
        delete: deleteFn,
        select: vi.fn(),
      }),
    },
  }
})

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: {
    checkCredits: vi.fn(),
    reserveCredits: vi.fn(),
  },
}))

vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))

// Markup source — node-executor mirrors the route guard (base -> ceil(base * (1+markup%))).
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: mockGetAppSettings }))

// The ee billing helper is loaded via DYNAMIC import in node-executor;
// mocking the module id intercepts that dynamic import too (same pattern
// generate-video-pro-dispatch.test.ts uses for its own ee helper).
vi.mock("@/ee/billing/edit-video-pro-credits.js", () => ({
  computeEditVideoProPricing: mockComputeEvpPricing,
}))

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { computeEditVideoProCreditOverride } from "../node-executor.js"

/** Minimal valid EditVideoProPricing-shaped mock — every field the override
 *  reads or stamps onto the payload is present with a realistic value.
 *  Individual tests override only the fields relevant to that case. */
function basePricing(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "replace",
    spanStartSec: 2,
    spanEndSec: 12,
    clampedSpanSec: 10,
    maxSpanSec: 120,
    segmentCount: 1,
    segmentDurations: [11],
    totalRawSec: 11,
    refsSecReserve: 2,
    outerSeamLossReserve: 0.6,
    feeBase: 10,
    refPerSecByResolution: { "480p": 2.875, "720p": 6.25, "1080p": 15.5, "4k": 32 },
    reserveResolution: "720p",
    reserveBase: 92,
    probe: { width: 720, height: 1280, durationSec: 20 },
    spanExceedsSource: false,
    ...overrides,
  }
}

describe("computeEditVideoProCreditOverride", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns undefined for non-evp payloads", async () => {
    const result = await computeEditVideoProCreditOverride({
      type: "generate-video-pro",
      provider: "seedance-2",
    })
    expect(result).toBeUndefined()
    expect(mockComputeEvpPricing).not.toHaveBeenCalled()

    // Neither marker present at all.
    const result2 = await computeEditVideoProCreditOverride({ provider: "seedance-2" })
    expect(result2).toBeUndefined()
    expect(mockComputeEvpPricing).not.toHaveBeenCalled()

    // Totally empty payload.
    const result3 = await computeEditVideoProCreditOverride({})
    expect(result3).toBeUndefined()
    expect(mockComputeEvpPricing).not.toHaveBeenCalled()
  })

  it("returns undefined when mode !== 'replace' (edit mode reserves nothing)", async () => {
    const payload: Record<string, unknown> = {
      type: "edit-video-pro",
      mode: "edit",
      provider: "seedance-2",
      videoUrl: "https://cdn.example.com/src.mp4",
      spanStart: 2,
      spanEnd: 12,
    }
    const result = await computeEditVideoProCreditOverride(payload)
    expect(result).toBeUndefined()
    expect(mockComputeEvpPricing).not.toHaveBeenCalled()
    // Untouched — the mode gate must short-circuit before any mutation.
    expect(payload.spanStart).toBe(2)
    expect(payload.spanEnd).toBe(12)
    expect(payload.proPricing).toBeUndefined()
  })

  it("clamps span before reserving: spanEnd - spanStart > maxSpan -> payload.spanEnd rewritten to the priced clamp", async () => {
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
    mockComputeEvpPricing.mockResolvedValue(
      basePricing({
        spanStartSec: 0,
        spanEndSec: 120, // priced clamp — the raw request (500) is money-side capped to maxSpanSec
        clampedSpanSec: 120,
        reserveBase: 500,
        probe: { width: 1280, height: 720, durationSec: 999 },
      }),
    )
    const payload: Record<string, unknown> = {
      type: "edit-video-pro",
      provider: "seedance-2",
      videoUrl: "https://cdn.example.com/src.mp4",
      spanStart: 0,
      spanEnd: 500, // way beyond maxSpanSec — the helper is the one that clamps
    }

    const result = await computeEditVideoProCreditOverride(payload)

    // Called with the RAW (unclamped) requested span — the helper clamps internally.
    expect(mockComputeEvpPricing).toHaveBeenCalledWith({
      provider: "seedance-2",
      sourceUrl: "https://cdn.example.com/src.mp4",
      spanStart: 0,
      spanEnd: 500,
    })
    expect(payload.spanEnd).toBe(120) // rewritten to the priced clamp
    expect(payload.spanStart).toBe(0)
    expect(result?.override).toBe(500)
  })

  it("stamps payload.proPricing and passes videoUrl as sourceUrl (probe args only — sourceDurationSec from node data is NEVER read)", async () => {
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
    mockComputeEvpPricing.mockResolvedValue(basePricing({ reserveBase: 92 }))
    const payload: Record<string, unknown> = {
      type: "edit-video-pro",
      provider: "seedance-2",
      videoUrl: "https://cdn.example.com/src.mp4",
      // Client-side display cache (loadedmetadata hint) — MUST never leak into
      // the probe args; the server always probes videoUrl itself for money.
      sourceDurationSec: 999999,
      spanStart: 2,
      spanEnd: 12,
    }

    const result = await computeEditVideoProCreditOverride(payload)

    expect(mockComputeEvpPricing).toHaveBeenCalledTimes(1)
    const callArgs = mockComputeEvpPricing.mock.calls[0]![0] as Record<string, unknown>
    expect(callArgs).toEqual({
      provider: "seedance-2",
      sourceUrl: "https://cdn.example.com/src.mp4",
      spanStart: 2,
      spanEnd: 12,
    })
    expect(callArgs).not.toHaveProperty("sourceDurationSec")

    expect(payload.proPricing).toEqual(expect.objectContaining({ reserveBase: 92 }))
    expect(payload.spanStart).toBe(2) // pricing.spanStartSec from basePricing()
    expect(payload.spanEnd).toBe(12) // pricing.spanEndSec from basePricing()
    expect(result?.pricing).toEqual(expect.objectContaining({ reserveBase: 92 }))
  })

  it("spanExceedsSource -> throws BEFORE any reservation math", async () => {
    mockComputeEvpPricing.mockResolvedValue(
      basePricing({
        spanExceedsSource: true,
        spanStartSec: 2,
        spanEndSec: 20, // clamped to the probed duration
        probe: { width: 720, height: 1280, durationSec: 20 },
        reserveBase: 999,
      }),
    )
    const payload: Record<string, unknown> = {
      type: "edit-video-pro",
      provider: "seedance-2",
      videoUrl: "https://cdn.example.com/src.mp4",
      spanStart: 2,
      spanEnd: 30, // beyond the (mocked) probed 20s source
    }

    await expect(computeEditVideoProCreditOverride(payload)).rejects.toThrow(
      /beyond the end of the source video/,
    )

    // "BEFORE any reservation math": no markup lookup, no payload mutation.
    expect(mockGetAppSettings).not.toHaveBeenCalled()
    expect(payload.spanStart).toBe(2)
    expect(payload.spanEnd).toBe(30)
    expect(payload.proPricing).toBeUndefined()
  })

  it("markup applied once: 20% markup -> ceil(reserveBase x 1.2)", async () => {
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 20 })
    mockComputeEvpPricing.mockResolvedValue(basePricing({ reserveBase: 92 }))
    const payload: Record<string, unknown> = {
      type: "edit-video-pro",
      provider: "seedance-2",
      videoUrl: "https://cdn.example.com/src.mp4",
      spanStart: 2,
      spanEnd: 12,
    }

    const result = await computeEditVideoProCreditOverride(payload)
    expect(result?.override).toBe(111) // ceil(92 * 1.2) = ceil(110.4) = 111

    // Recognizes the dispatch via payload.jobName as well as payload.type,
    // and override === reserveBase exactly when markup is 0.
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
    const jobNamePayload: Record<string, unknown> = {
      jobName: "edit-video-pro",
      provider: "seedance-2",
      videoUrl: "https://cdn.example.com/src.mp4",
      spanStart: 2,
      spanEnd: 12,
    }
    const result2 = await computeEditVideoProCreditOverride(jobNamePayload)
    expect(result2?.override).toBe(92)
  })
})

/**
 * generate-video-pro DAG dispatch — Task 10.
 *
 * Three independent surfaces, one file:
 *
 * 1. payload-builder: the thin `case "generate-video-pro"` dispatch shape
 *    (mirrors `voice-changer-pro`'s `simpleResult` case). Calls `buildPayload`
 *    directly with REAL dependencies (no mocking) — mirrors
 *    `ltx-dispatch.test.ts`'s style, since the case is pure data mapping.
 *
 * 2. node-executor: `computeGenerateVideoProCreditOverride` — both as a
 *    direct unit (the override math + the duration-clamp/proPricing payload
 *    mutation) and wired through the real `executeNode` → credit-reservation
 *    flow (mirrors `seedance2-ref-video-reserve.test.ts`'s
 *    reject-reserveCredits short-circuit trick, but — unlike that file —
 *    does NOT mock `payload-builder.js` / `@nodaro/shared` / `@nodaro/prompts`,
 *    so the REAL payload-builder case (surface 1) is what produces the
 *    dispatch the override recognizes. Only the credit/queue/supabase/
 *    app-settings/ee-pricing-helper layer is mocked.
 *
 * 3. cron + timeout constants: `STUCK_ORCHESTRATOR_JOB_TYPES` (cron.ts) and
 *    `WORKFLOW_TIMEOUT_MS` (types.ts) are plain exported values — asserted
 *    directly, no mocking needed.
 *
 * Money-path note: the override's clamp is the ONLY clamp on the DAG path
 * (there is no route Zod yet for this node), so the payload-mutation
 * assertions in group 2 are the load-bearing ones — without them a
 * mis-clamped or unclamped duration would ask the private-plugin engine to
 * generate more video than what was priced.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mock state — declared before vi.mock() calls
// ---------------------------------------------------------------------------

const {
  mockCheckCredits,
  mockReserveCredits,
  mockGetAppSettings,
  mockComputeGvpPricing,
  mockVideoQueueAdd,
} = vi.hoisted(() => ({
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockGetAppSettings: vi.fn(),
  mockComputeGvpPricing: vi.fn(),
  mockVideoQueueAdd: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Mocks — ONLY the credit/queue/supabase/app-settings/ee-pricing layer.
// payload-builder.js, @nodaro/shared, and @nodaro/prompts are left REAL so
// group 1's direct buildPayload() calls exercise production code, and so
// group 2's executeNode() calls dispatch through the REAL payload-builder
// case rather than a hand-built stand-in that could drift from it.
// ---------------------------------------------------------------------------

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
    checkCredits: mockCheckCredits,
    reserveCredits: mockReserveCredits,
  },
}))

vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockVideoQueueAdd } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))

// Markup source — node-executor mirrors the route guard (base -> ceil(base * (1+markup%))).
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: mockGetAppSettings }))

// The ee billing helper is loaded via DYNAMIC import in node-executor;
// mocking the module id intercepts that dynamic import too (same pattern
// seedance2-ref-video-reserve.test.ts uses for its own ee helper).
vi.mock("@/ee/billing/generate-video-pro-credits.js", () => ({
  computeGenerateVideoProPricing: mockComputeGvpPricing,
}))

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { buildPayload } from "../payload-builder.js"
import { executeNode, computeGenerateVideoProCreditOverride } from "../node-executor.js"
import { WORKFLOW_TIMEOUT_MS } from "../types.js"
import type { SimpleNode, ResolvedInputs, OrchestratorContext } from "../types.js"
import { STUCK_ORCHESTRATOR_JOB_TYPES } from "../../../lib/reconcile/cron.js"

const JOB_ID = "job-1"

function gvpNode(data: Record<string, unknown> = {}): SimpleNode {
  return { id: "gvp-1", type: "generate-video-pro", data }
}

// ---------------------------------------------------------------------------
// 1. payload-builder — real buildPayload(), no mocking needed
// ---------------------------------------------------------------------------

describe("payload-builder: generate-video-pro dispatch", () => {
  it("returns jobName/queueName/modelIdentifier = generate-video-pro", () => {
    const n = gvpNode({ prompt: "a cat dancing under neon lights" })
    const result = buildPayload(n, JOB_ID, {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
    expect(result.jobName).toBe("generate-video-pro")
    expect(result.queueName).toBe("video-generation")
    expect(result.modelIdentifier).toBe("generate-video-pro")
  })

  it("carries prompt/provider/duration/resolution/aspectRatio/generateAudio from node data", () => {
    const n = gvpNode({
      prompt: "a cat dancing under neon lights",
      provider: "seedance-2-mini",
      duration: 12,
      resolution: "480p",
      aspectRatio: "9:16",
      generateAudio: false,
    })
    const result = buildPayload(n, JOB_ID, {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
    expect(result.payload.type).toBe("generate-video-pro")
    expect(result.payload.prompt).toBe("a cat dancing under neon lights")
    expect(result.payload.provider).toBe("seedance-2-mini")
    expect(result.payload.duration).toBe(12)
    expect(result.payload.resolution).toBe("480p")
    expect(result.payload.aspectRatio).toBe("9:16")
    expect(result.payload.generateAudio).toBe(false)
  })

  it("defaults provider to seedance-2, resolution to 720p, aspectRatio to adaptive when unset", () => {
    const n = gvpNode({ prompt: "a cat" })
    const result = buildPayload(n, JOB_ID, {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
    expect(result.payload.provider).toBe("seedance-2")
    expect(result.payload.resolution).toBe("720p")
    expect(result.payload.aspectRatio).toBe("adaptive")
  })

  it("prefers wired resolvedInputs over node data for startFrameUrl / referenceImageUrls", () => {
    const n = gvpNode({
      prompt: "a cat",
      startFrameUrl: "https://data.example/start.png",
      referenceImageUrls: ["https://data.example/ref.png"],
    })
    const inputs: ResolvedInputs = {
      startFrameUrl: "https://wired.example/start.png",
      referenceImageUrls: ["https://wired.example/ref1.png", "https://wired.example/ref2.png"],
    }
    const result = buildPayload(n, JOB_ID, inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
    expect(result.payload.startFrameUrl).toBe("https://wired.example/start.png")
    expect(result.payload.referenceImageUrls).toEqual([
      "https://wired.example/ref1.png",
      "https://wired.example/ref2.png",
    ])
  })

  it("falls back to node data for startFrameUrl / referenceImageUrls when nothing is wired", () => {
    const n = gvpNode({
      prompt: "a cat",
      startFrameUrl: "https://data.example/start.png",
      referenceImageUrls: ["https://data.example/ref.png"],
    })
    const result = buildPayload(n, JOB_ID, {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
    expect(result.payload.startFrameUrl).toBe("https://data.example/start.png")
    expect(result.payload.referenceImageUrls).toEqual(["https://data.example/ref.png"])
  })

  it("falls back to resolvedInputs.imageUrl for startFrameUrl when startFrameUrl isn't wired", () => {
    const n = gvpNode({ prompt: "a cat" })
    const inputs: ResolvedInputs = { imageUrl: "https://wired.example/generic-image.png" }
    const result = buildPayload(n, JOB_ID, inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
    expect(result.payload.startFrameUrl).toBe("https://wired.example/generic-image.png")
  })
})

// ---------------------------------------------------------------------------
// 2a. computeGenerateVideoProCreditOverride — direct unit tests
// ---------------------------------------------------------------------------

describe("computeGenerateVideoProCreditOverride", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns undefined for a payload that isn't a generate-video-pro dispatch", async () => {
    const result = await computeGenerateVideoProCreditOverride({ type: "image-to-video", provider: "seedance-2" })
    expect(result).toBeUndefined()
    expect(mockComputeGvpPricing).not.toHaveBeenCalled()
  })

  it("computes ceil(reserveBase x (1 + markup/100)), clamps payload.duration, and stamps payload.proPricing", async () => {
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 30 })
    mockComputeGvpPricing.mockResolvedValue({
      mode: "multi",
      clampedDurationSec: 120,
      segmentCount: 9,
      totalRawSec: 122.4,
      segmentDurations: [14, 14, 14, 14, 14, 14, 14, 14, 10],
      feeBase: 10,
      noRefPerSec: 6.25,
      refPerSec: 7.5,
      tailSec: 1,
      reserveBase: 483,
    })
    const payload: Record<string, unknown> = {
      type: "generate-video-pro",
      provider: "seedance-2",
      resolution: "720p",
      duration: 300,
    }

    const result = await computeGenerateVideoProCreditOverride(payload)

    // The helper is called with the RAW (unclamped) requested duration — it
    // does the clamping internally and reports clampedDurationSec back.
    expect(mockComputeGvpPricing).toHaveBeenCalledWith({
      provider: "seedance-2",
      resolution: "720p",
      durationSec: 300,
    })

    expect(result?.override).toBe(628) // ceil(483 * 1.3) = ceil(627.9) = 628
    expect(payload.duration).toBe(120) // clamped BEFORE this returns
    expect(payload.proPricing).toEqual(
      expect.objectContaining({ reserveBase: 483, clampedDurationSec: 120 }),
    )
  })

  it("override === reserveBase when markup is 0", async () => {
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
    mockComputeGvpPricing.mockResolvedValue({
      mode: "single",
      clampedDurationSec: 8,
      segmentCount: 1,
      totalRawSec: 8,
      segmentDurations: [8],
      feeBase: 0,
      noRefPerSec: 6.25,
      refPerSec: 7.5,
      tailSec: 1,
      reserveBase: 50,
      creditIdentifier: "seedance-2:8s:720p",
    })
    const payload: Record<string, unknown> = {
      type: "generate-video-pro",
      provider: "seedance-2",
      resolution: "720p",
      duration: 8,
    }

    const result = await computeGenerateVideoProCreditOverride(payload)
    expect(result?.override).toBe(50)
    expect(payload.duration).toBe(8)
  })

  it("recognizes the dispatch via payload.jobName as well as payload.type", async () => {
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
    mockComputeGvpPricing.mockResolvedValue({
      mode: "single",
      clampedDurationSec: 8,
      segmentCount: 1,
      totalRawSec: 8,
      segmentDurations: [8],
      feeBase: 0,
      noRefPerSec: 6.25,
      refPerSec: 7.5,
      tailSec: 1,
      reserveBase: 50,
    })
    const payload: Record<string, unknown> = { jobName: "generate-video-pro", provider: "seedance-2", resolution: "720p", duration: 8 }
    const result = await computeGenerateVideoProCreditOverride(payload)
    expect(result?.override).toBe(50)
  })

  it("defaults provider/resolution/duration when the payload omits them", async () => {
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
    mockComputeGvpPricing.mockResolvedValue({
      mode: "single",
      clampedDurationSec: 8,
      segmentCount: 1,
      totalRawSec: 8,
      segmentDurations: [8],
      feeBase: 0,
      noRefPerSec: 6.25,
      refPerSec: 7.5,
      tailSec: 1,
      reserveBase: 50,
    })
    const payload: Record<string, unknown> = { type: "generate-video-pro" }
    await computeGenerateVideoProCreditOverride(payload)
    expect(mockComputeGvpPricing).toHaveBeenCalledWith({
      provider: "seedance-2",
      resolution: "720p",
      durationSec: 8,
    })
  })
})

// ---------------------------------------------------------------------------
// 2b. node-executor wiring — real payload-builder + real executeNode(),
// only the credit/queue/supabase/app-settings/ee-helper layer mocked.
// ---------------------------------------------------------------------------

function makeCtx(): OrchestratorContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    userId: "user-1",
    triggerType: "manual",
    cancelled: false,
    isAppRun: false,
    onJobCreated: vi.fn(),
  } as unknown as OrchestratorContext
}

describe("node-executor — generate-video-pro credit override wiring (Task 10)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 30 })
    mockComputeGvpPricing.mockResolvedValue({
      mode: "multi",
      clampedDurationSec: 120,
      segmentCount: 9,
      totalRawSec: 122.4,
      segmentDurations: [14, 14, 14, 14, 14, 14, 14, 14, 10],
      feeBase: 10,
      noRefPerSec: 6.25,
      refPerSec: 7.5,
      tailSec: 1,
      reserveBase: 483,
    })
    mockCheckCredits.mockResolvedValue({ allowed: true, balance: 5000, watermark: false })
    // Short-circuit before pollJobToCompletion hangs — mirrors
    // seedance2-ref-video-reserve.test.ts's established pattern.
    mockReserveCredits.mockRejectedValue(new Error("reservation-sentinel"))
  })

  it("threads the clamped, marked-up override into BOTH checkCredits and reserveCredits", async () => {
    const node: SimpleNode = {
      id: "n1",
      type: "generate-video-pro",
      data: { provider: "seedance-2", resolution: "720p", duration: 300, prompt: "a cat dancing" },
    }

    await expect(
      executeNode(node, {}, [], [], {}, makeCtx()),
    ).rejects.toThrow(/reservation-sentinel|Credit reservation failed/)

    // The real payload-builder case fed the (unclamped) requested duration in.
    expect(mockComputeGvpPricing).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "seedance-2", resolution: "720p", durationSec: 300 }),
    )

    expect(mockCheckCredits).toHaveBeenCalledTimes(1)
    const [checkUserId, checkModelId, , checkOverride] = mockCheckCredits.mock.calls[0] as [
      string, string, boolean | undefined, number | undefined,
    ]
    expect(checkUserId).toBe("user-1")
    expect(checkModelId).toBe("generate-video-pro")
    expect(checkOverride).toBe(628) // ceil(483 * 1.3)

    expect(mockReserveCredits).toHaveBeenCalledTimes(1)
    const [resUserId, resJobId, resModelId, , , resOptions] = mockReserveCredits.mock.calls[0] as [
      string, string, string, number, number, { creditOverride?: number } | undefined,
    ]
    expect(resUserId).toBe("user-1")
    expect(resJobId).toBe("test-job-id")
    expect(resModelId).toBe("generate-video-pro")
    expect(resOptions?.creditOverride).toBe(628)
  })

  it("pins the clamped payload to the enqueued job — resolveCredits succeeds → queue.add receives duration:120 + proPricing", async () => {
    // This test verifies that when both credit checks pass (checkCredits and
    // reserveCredits resolve successfully), the override-clamped payload reaches
    // the enqueued job. Without this, a refactor moving the override after the
    // payload spread would revert to static under-reserve while tests stay green.
    const node: SimpleNode = {
      id: "n1",
      type: "generate-video-pro",
      data: { provider: "seedance-2", resolution: "720p", duration: 300, prompt: "a cat dancing" },
    }

    // Resolve successfully to proceed past credit reservation
    mockReserveCredits.mockResolvedValue({ usageLogId: "ul-1", creditsReserved: 628, watermark: false })

    // Mock queue.add to throw after recording its call — avoids hang on
    // pollJobToCompletion while still asserting the payload shape.
    mockVideoQueueAdd.mockImplementationOnce(() => {
      throw new Error("queue-add-sentinel")
    })

    // Execution proceeds to queue.add and throws; we catch + assert on the call
    await expect(
      executeNode(node, {}, [], [], {}, makeCtx()),
    ).rejects.toThrow("queue-add-sentinel")

    // Verify queue.add was called with the clamped payload
    expect(mockVideoQueueAdd).toHaveBeenCalledTimes(1)
    const [jobName, payload] = mockVideoQueueAdd.mock.calls[0] as [string, Record<string, unknown>]
    expect(jobName).toBe("generate-video-pro")
    expect(payload).toMatchObject({
      duration: 120, // clamped from requested 300
      proPricing: expect.objectContaining({ clampedDurationSec: 120 }),
      usageLogId: "ul-1",
    })
  })

  it("does not invoke the generate-video-pro pricing helper for an unrelated node type", async () => {
    const node: SimpleNode = {
      id: "n2",
      type: "text-to-speech",
      data: { ttsModel: "eleven_turbo_v2_5" },
    }
    mockReserveCredits.mockResolvedValue({ usageLogId: "ul-1", creditsReserved: 3, watermark: false })

    // text-to-speech is a SYNC_HTTP node, so executeNode dispatches to an
    // internal fetch this test doesn't mock — just assert the GVP pricing
    // helper stays untouched rather than asserting on the (irrelevant)
    // outcome of the sync-HTTP call itself.
    await executeNode(node, {}, [], [], {}, makeCtx()).catch(() => {})
    expect(mockComputeGvpPricing).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 3. cron stuck-sweep type list + workflow timeout constant
// ---------------------------------------------------------------------------

describe("cron: stuck-orchestrator sweep type list", () => {
  it("includes generate-video-pro alongside render-video and video-director", () => {
    expect(STUCK_ORCHESTRATOR_JOB_TYPES).toContain("generate-video-pro")
    expect(STUCK_ORCHESTRATOR_JOB_TYPES).toContain("render-video")
    expect(STUCK_ORCHESTRATOR_JOB_TYPES).toContain("video-director")
  })
})

describe("WORKFLOW_TIMEOUT_MS", () => {
  it("is 120 minutes (raised from 60 to cover a generate-video-pro multi-segment stitch)", () => {
    expect(WORKFLOW_TIMEOUT_MS).toBe(120 * 60 * 1000)
  })
})

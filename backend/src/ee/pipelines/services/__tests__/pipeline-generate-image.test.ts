import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mocks must be declared before the import-under-test so the dynamic
// imports inside pipeline-generate-image.ts pick them up. Mock paths match
// what the SUT imports (relative to `services/pipeline-generate-image.ts`),
// NOT relative to this test file.
vi.mock("../../../../lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock("../../../billing/credits.js", () => ({
  CreditsService: {
    reserveCredits: vi.fn().mockResolvedValue({
      usageLogId: "log-1",
      creditsReserved: 2,
      watermark: false,
    }),
  },
}))

import { videoQueue } from "../../../../lib/queue.js"
import { CreditsService } from "../../../billing/credits.js"
import { pipelineGenerateImage } from "../pipeline-generate-image.js"

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Build a Supabase mock whose `.from("jobs").select().eq().maybeSingle()`
 * walks through `jobStates`, returning each successive state on each poll.
 * After the list is exhausted, the last state repeats.
 *
 * Also fakes:
 *   - `.from("jobs").insert(...).select(...).single()` → returns `{id: "job-1"}`.
 *   - `.from("assets").select().eq().eq().maybeSingle()` → returns `assetRow`
 *     (or null when unset).
 *   - `.from("assets").update(...).eq(...)` → returns `{data:null, error:null}`
 *     and records the update payload in `recorded.assetUpdate`.
 */
function makeSupabaseMock(opts: {
  jobStates: Array<{
    status: string
    output_data?: Record<string, unknown>
    error_message?: string | null
    credits_actual?: number | null
  }>
  assetRow?: { id: string } | null
}) {
  let pollIdx = 0
  const recorded = {
    jobInsert: undefined as Record<string, unknown> | undefined,
    assetUpdate: undefined as Record<string, unknown> | undefined,
    assetUpdateEqArgs: undefined as { col: string; val: string } | undefined,
  }
  const supabase = {
    rpc: vi.fn(),
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "jobs") {
        return {
          insert: (payload: Record<string, unknown>) => {
            recorded.jobInsert = payload
            return {
              select: () => ({
                single: async () => ({ data: { id: "job-1" }, error: null }),
              }),
            }
          },
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                const idx = Math.min(pollIdx, opts.jobStates.length - 1)
                pollIdx += 1
                return { data: opts.jobStates[idx], error: null }
              },
            }),
          }),
        }
      }
      if (table === "assets") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: opts.assetRow ?? null,
                  error: null,
                }),
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            recorded.assetUpdate = payload
            return {
              eq: async (col: string, val: string) => {
                recorded.assetUpdateEqArgs = { col, val }
                return { data: null, error: null }
              },
            }
          },
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    }),
  }
  return { supabase: supabase as never, recorded }
}

/** Drains microtasks + timers until the promise settles or we hit a cap.
 * Necessary because the helper does `await import(...)` and Supabase
 * await chains between fake-timer sleeps; a single advanceTimersByTimeAsync
 * call is not enough to walk it to completion. */
async function runUntilSettled<T>(
  promise: Promise<T>,
  stepMs = 3500,
  maxSteps = 30,
): Promise<T> {
  for (let i = 0; i < maxSteps; i++) {
    let settled = false
    promise.then(() => { settled = true }, () => { settled = true })
    await vi.advanceTimersByTimeAsync(stepMs)
    // Yield to microtasks so any awaited dynamic-import / supabase chain resolves.
    await Promise.resolve()
    if (settled) break
  }
  return promise
}

describe("pipelineGenerateImage", () => {
  it("returns asset when job completes", async () => {
    const { supabase, recorded } = makeSupabaseMock({
      jobStates: [
        { status: "processing" },
        {
          status: "completed",
          output_data: { imageUrl: "https://r2/a1.png" },
          credits_actual: 2,
        },
      ],
      assetRow: { id: "asset-123" },
    })

    const promise = pipelineGenerateImage({
      supabase,
      pipelineId: "p1",
      pipelineEntityId: "e1",
      userId: "u1",
      prompt: "weathered pilot portrait",
    })
    const result = await runUntilSettled(promise)

    expect(result.assetId).toBe("asset-123")
    expect(result.assetUrl).toBe("https://r2/a1.png")
    expect(result.creditsSpent).toBe(2)
    expect(result.jobId).toBe("job-1")

    // Job insert tagged with pipeline_id.
    expect(recorded.jobInsert).toMatchObject({
      user_id: "u1",
      status: "pending",
      pipeline_id: "p1",
    })

    // Credits reserved via positional API.
    expect(CreditsService.reserveCredits).toHaveBeenCalledWith(
      "u1",
      "job-1",
      "nano-banana",
      0,
      0,
      { isAppRun: false },
    )

    // Queue add: flat payload shape the worker destructures.
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-image",
      expect.objectContaining({
        jobId: "job-1",
        prompt: "weathered pilot portrait",
        provider: "nano-banana",
        aspectRatio: "1:1",
        usageLogId: "log-1",
      }),
    )

    // Asset linked to the entity (DB trigger fills pipeline_id).
    expect(recorded.assetUpdate).toEqual({ pipeline_entity_id: "e1" })
    expect(recorded.assetUpdateEqArgs).toEqual({ col: "id", val: "asset-123" })
  })

  it("throws when job fails", async () => {
    const { supabase } = makeSupabaseMock({
      jobStates: [{ status: "failed", error_message: "provider error" }],
    })

    const promise = pipelineGenerateImage({
      supabase,
      pipelineId: "p1",
      pipelineEntityId: "e1",
      userId: "u1",
      prompt: "test",
    })
    // Swallow the rejection so the helper's internal awaits don't trip
    // "uncaught" before we get to .rejects below.
    promise.catch(() => undefined)
    await runUntilSettled(promise.then(
      () => undefined,
      () => undefined,
    ))
    await expect(promise).rejects.toThrow(/Image generation failed: provider error/)
  })

  it("throws when completed job has no imageUrl", async () => {
    const { supabase } = makeSupabaseMock({
      jobStates: [{ status: "completed", output_data: {} }],
    })

    const promise = pipelineGenerateImage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      prompt: "test",
    })
    promise.catch(() => undefined)
    await runUntilSettled(promise.then(
      () => undefined,
      () => undefined,
    ))
    await expect(promise).rejects.toThrow(/completed without imageUrl/)
  })

  it("returns assetId=null when asset row never lands", async () => {
    const { supabase, recorded } = makeSupabaseMock({
      jobStates: [
        {
          status: "completed",
          output_data: { imageUrl: "https://r2/no-asset.png" },
          credits_actual: 2,
        },
      ],
      assetRow: null, // simulate the race window where createAssetFromJob hasn't run yet
    })

    const promise = pipelineGenerateImage({
      supabase,
      pipelineId: "p1",
      pipelineEntityId: "e1",
      userId: "u1",
      prompt: "test",
    })
    // Asset polling has its own ~15s deadline; advance well past it.
    const result = await runUntilSettled(promise, 1000, 60)

    expect(result.assetId).toBeNull()
    expect(result.assetUrl).toBe("https://r2/no-asset.png")
    // No assets UPDATE when there's no asset row to update.
    expect(recorded.assetUpdate).toBeUndefined()
  })

  it("uses the modelIdentifier override when provided", async () => {
    const { supabase } = makeSupabaseMock({
      jobStates: [
        {
          status: "completed",
          output_data: { imageUrl: "https://r2/a.png" },
          credits_actual: 6,
        },
      ],
      assetRow: { id: "asset-1" },
    })

    const promise = pipelineGenerateImage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      prompt: "hi",
      modelIdentifier: "nano-banana-pro",
      referenceImageUrls: ["https://ref/1.png"],
      aspectRatio: "16:9",
    })
    await runUntilSettled(promise)

    expect(CreditsService.reserveCredits).toHaveBeenCalledWith(
      "u1",
      "job-1",
      "nano-banana-pro",
      0,
      0,
      { isAppRun: false },
    )
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-image",
      expect.objectContaining({
        provider: "nano-banana-pro",
        aspectRatio: "16:9",
        referenceImageUrls: ["https://ref/1.png"],
      }),
    )
  })
})

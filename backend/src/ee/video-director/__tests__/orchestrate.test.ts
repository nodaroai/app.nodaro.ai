/**
 * Unit tests for runVideoDirector (Unit D) — pure orchestration chain.
 *
 * Strategy: fully-mocked deps + vi.mock on bakeShotSequence so we can:
 *   (a) assert call order via a recorded onProgress sequence
 *   (b) assert bakeShotSequence receives alignment from the alignment job
 *       and audioUrl from the speech job
 *   (c) assert the returned videoUrl comes from the render job
 *   (d) assert a throwing createRenderJob surfaces an error mentioning "render"
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock bakeShotSequence BEFORE importing the module under test so vitest's
// mock-hoisting intercepts the dynamic import that orchestrate.ts makes.
// vi.hoisted() is required so `mockBake` is available inside the vi.mock factory.
// (This mock is per-file and MUST stay here; the plain fixtures live in
// ./orchestrate-fixtures.ts.)
// ---------------------------------------------------------------------------
const { mockBake } = vi.hoisted(() => ({
  mockBake: vi.fn(),
}))
vi.mock("@/services/shot-sequence/baker.js", () => ({
  bakeShotSequence: mockBake,
}))

import { runVideoDirector } from "../orchestrate.js"
import {
  AUDIO_URL,
  VIDEO_URL,
  ALIGNMENT,
  MOCK_PLAN,
  MOCK_AUTHORED,
  BASE_OPTS,
  buildDeps,
} from "./orchestrate-fixtures.js"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("runVideoDirector", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBake.mockReturnValue({ plan: MOCK_PLAN, warnings: [] })
  })

  it("(a) calls pipeline steps in the correct order", async () => {
    const callLog: string[] = []
    const deps = buildDeps({
      onProgress: (step: string) => {
        callLog.push(step)
      },
    })

    await runVideoDirector(BASE_OPTS, deps)

    expect(callLog).toEqual(["authoring", "speech", "alignment", "resolve", "render"])
  })

  it("(a2) awaits onProgress before the next step so a stale progress write can't stomp the terminal status", async () => {
    // Regression: the worker's onProgress does an async jobs-row `status:processing`
    // update. If runVideoDirector fires it un-awaited, that write can land AFTER the
    // terminal (failed/completed) write, leaving a failed job stuck at "processing".
    // Assert onProgress's async work COMPLETES before the next step runs.
    const order: string[] = []
    const deps = buildDeps({
      onProgress: async (step: string) => {
        await Promise.resolve() // model the async supabase update (a microtask hop)
        order.push(`progress:${step}`)
      },
      createSpeechJob: vi.fn(async () => {
        order.push("speech-job")
        return { jobId: "speech-1" }
      }),
    })

    await runVideoDirector(BASE_OPTS, deps)

    // onProgress("speech") must be fully awaited before createSpeechJob is invoked.
    // Un-awaited, "speech-job" records first and this fails.
    expect(order.indexOf("progress:speech")).toBeLessThan(order.indexOf("speech-job"))
  })

  it("(b) passes alignment from alignment job + audioUrl from speech job to bakeShotSequence", async () => {
    const deps = buildDeps()
    await runVideoDirector(BASE_OPTS, deps)

    expect(mockBake).toHaveBeenCalledTimes(1)
    expect(mockBake).toHaveBeenCalledWith(
      MOCK_AUTHORED.shotSequenceBrief,
      ALIGNMENT,
      AUDIO_URL,
    )
  })

  it("(c) returns the videoUrl from the render job output", async () => {
    const deps = buildDeps()
    const result = await runVideoDirector(BASE_OPTS, deps)

    expect(result).toEqual({ videoUrl: VIDEO_URL, planType: "shot-sequence" })
  })

  it("(d) throws an error mentioning 'render' when createRenderJob throws", async () => {
    const deps = buildDeps({
      createRenderJob: vi.fn().mockRejectedValue(new Error("render endpoint 503")),
    })

    await expect(runVideoDirector(BASE_OPTS, deps)).rejects.toThrow(/render/)
  })

  it("(e) surfaces a 'resolve'-prefixed error when the bake throws (SceneOverlapError) — the credit-leak-backstop seam", async () => {
    // A genuine cross-scene cue interleave makes bakeShotSequence throw SceneOverlapError.
    // runVideoDirector MUST re-throw it as a `resolve:`-prefixed Error so it propagates
    // out of the chain — the video-director worker's catch then marks the job failed and
    // refunds the reserved authoring credit (covered by video-director-worker.test.ts).
    // Without this propagation the reserved credit would strand ("processing", no refund).
    mockBake.mockImplementation(() => {
      throw new Error(
        'Scene "s2" starts at frame 0 but scene "s1" runs until 20. ' +
          "Reveal cue spans must not interleave across scenes.",
      )
    })
    const deps = buildDeps()

    await expect(runVideoDirector(BASE_OPTS, deps)).rejects.toThrow(/resolve/)
  })
})

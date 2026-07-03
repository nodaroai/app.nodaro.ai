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
  MOCK_REPAIRED,
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

  // -------------------------------------------------------------------------
  // Task T2 — one-round author self-repair on resolver rejection
  // -------------------------------------------------------------------------
  describe("author self-repair (Task T2)", () => {
    it("(f) bake fails once → repairs (author called twice, 2nd call carries repair.resolverError) and re-bake succeeds → pipeline continues to render", async () => {
      const bakeErrorMsg = "scene overlap detected"
      mockBake
        .mockImplementationOnce(() => {
          throw new Error(bakeErrorMsg)
        })
        .mockReturnValueOnce({ plan: MOCK_PLAN, warnings: [] })

      const author = vi.fn().mockResolvedValueOnce(MOCK_AUTHORED).mockResolvedValueOnce(MOCK_REPAIRED)
      const deps = buildDeps({ author })

      const result = await runVideoDirector(BASE_OPTS, deps)

      // author called exactly twice: the original authoring call + one repair call.
      expect(author).toHaveBeenCalledTimes(2)
      const secondCallOpts = author.mock.calls[1][0] as {
        repair?: { previousBrief: unknown; resolverError: string }
      }
      expect(secondCallOpts.repair).toEqual({
        previousBrief: MOCK_AUTHORED,
        resolverError: `resolve: ${bakeErrorMsg}`,
      })

      // bakeShotSequence retried exactly once, with the REPAIRED brief.
      expect(mockBake).toHaveBeenCalledTimes(2)
      expect(mockBake.mock.calls[1][0]).toEqual(MOCK_REPAIRED.shotSequenceBrief)

      // Pipeline continues through render with the same final shape as the happy path.
      expect(result).toEqual({ videoUrl: VIDEO_URL, planType: "shot-sequence" })
    })

    it("(g) repaired brief with a CHANGED voScript discards the repair and throws the ORIGINAL bake error without re-baking", async () => {
      const bakeErrorMsg = "scene overlap detected"
      mockBake.mockImplementation(() => {
        throw new Error(bakeErrorMsg)
      })

      const driftedRepair = { ...MOCK_REPAIRED, voScript: "Ship faster than ever." }
      const author = vi.fn().mockResolvedValueOnce(MOCK_AUTHORED).mockResolvedValueOnce(driftedRepair)
      const deps = buildDeps({ author })

      await expect(runVideoDirector(BASE_OPTS, deps)).rejects.toThrow(`resolve: ${bakeErrorMsg}`)

      expect(author).toHaveBeenCalledTimes(2)
      // Re-bake must NOT run when the invariant is violated.
      expect(mockBake).toHaveBeenCalledTimes(1)
    })

    it("(h) repaired brief with changed cue text (voScript unchanged) discards the repair and throws the ORIGINAL bake error without re-baking", async () => {
      const bakeErrorMsg = "scene overlap detected"
      mockBake.mockImplementation(() => {
        throw new Error(bakeErrorMsg)
      })

      const driftedRepair = {
        ...MOCK_REPAIRED,
        cues: [{ id: "c1", text: "Ship slower" }],
      }
      const author = vi.fn().mockResolvedValueOnce(MOCK_AUTHORED).mockResolvedValueOnce(driftedRepair)
      const deps = buildDeps({ author })

      await expect(runVideoDirector(BASE_OPTS, deps)).rejects.toThrow(`resolve: ${bakeErrorMsg}`)

      expect(author).toHaveBeenCalledTimes(2)
      expect(mockBake).toHaveBeenCalledTimes(1)
    })

    it("(i) bake fails twice (repair still invalid) → surfaces the SECOND bake error, author called exactly twice, no infinite loop", async () => {
      mockBake
        .mockImplementationOnce(() => {
          throw new Error("first overlap error")
        })
        .mockImplementationOnce(() => {
          throw new Error("second overlap error")
        })

      const author = vi.fn().mockResolvedValueOnce(MOCK_AUTHORED).mockResolvedValueOnce(MOCK_REPAIRED)
      const deps = buildDeps({ author })

      await expect(runVideoDirector(BASE_OPTS, deps)).rejects.toThrow("resolve: second overlap error")

      expect(author).toHaveBeenCalledTimes(2)
      expect(mockBake).toHaveBeenCalledTimes(2)
    })

    it("(j) speech/alignment/render failures do NOT trigger repair — author is called exactly once", async () => {
      const author = vi.fn().mockResolvedValue(MOCK_AUTHORED)

      let deps = buildDeps({
        author,
        createSpeechJob: vi.fn().mockRejectedValue(new Error("tts down")),
      })
      await expect(runVideoDirector(BASE_OPTS, deps)).rejects.toThrow(/speech/)
      expect(author).toHaveBeenCalledTimes(1)

      author.mockClear()
      deps = buildDeps({
        author,
        createAlignmentJob: vi.fn().mockRejectedValue(new Error("align down")),
      })
      await expect(runVideoDirector(BASE_OPTS, deps)).rejects.toThrow(/alignment/)
      expect(author).toHaveBeenCalledTimes(1)

      author.mockClear()
      deps = buildDeps({
        author,
        createRenderJob: vi.fn().mockRejectedValue(new Error("render down")),
      })
      await expect(runVideoDirector(BASE_OPTS, deps)).rejects.toThrow(/render/)
      expect(author).toHaveBeenCalledTimes(1)
    })
  })
})

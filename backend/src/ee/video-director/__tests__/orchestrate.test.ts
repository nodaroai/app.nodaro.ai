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
import type { DirectorDeps } from "../orchestrate.js"
import type { AuthoredSequence } from "../author.js"

// ---------------------------------------------------------------------------
// Mock bakeShotSequence BEFORE importing the module under test so vitest's
// mock-hoisting intercepts the dynamic import that orchestrate.ts makes.
// vi.hoisted() is required so `mockBake` is available inside the vi.mock factory.
// ---------------------------------------------------------------------------
const { mockBake } = vi.hoisted(() => ({
  mockBake: vi.fn(),
}))
vi.mock("@/services/shot-sequence/baker.js", () => ({
  bakeShotSequence: mockBake,
}))

import { runVideoDirector } from "../orchestrate.js"

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const AUDIO_URL = "https://cdn.example.com/speech.mp3"
const VIDEO_URL = "https://cdn.example.com/result.mp4"
const ALIGNMENT = [{ word: "Ship", start: 0.1, end: 0.4 }]
const MOCK_PLAN = { planType: "shot-sequence", fps: 30 } // minimal; baker is mocked

const MOCK_BRIEF_OBJ = {
  fps: 30,
  width: 1920,
  height: 1080,
  backgroundColor: "#000",
  narration: {
    script: "Ship faster.",
    cues: [{ id: "c1", text: "Ship faster" }],
  },
  scenes: [
    {
      id: "s1",
      shots: [
        {
          id: "sh1",
          reveals: [
            {
              id: "r1",
              element: {
                id: "e1",
                type: "text",
                text: "Ship faster",
                fontFamily: "Anton",
                fontSize: 120,
                color: "#fff",
                x: 140,
                y: 300,
              },
              revealAt: { kind: "cue", cueId: "c1", edge: "start" },
              enter: { motion: "slide-up", durationFrames: 12 },
            },
          ],
        },
      ],
    },
  ],
}

// The authored output from the mocked author function.
const MOCK_AUTHORED = {
  voScript: "Ship faster.",
  cues: [{ id: "c1", text: "Ship faster" }],
  shotSequenceBrief: MOCK_BRIEF_OBJ,
} as AuthoredSequence

const BASE_OPTS = {
  genre: "explainer" as const,
  brief: "Nodaro MVP promo",
  userId: "u-test-1",
  tier: "pro",
}

// ---------------------------------------------------------------------------
// Helper: build fully-mocked deps
// ---------------------------------------------------------------------------
function buildDeps(overrides: Partial<DirectorDeps> = {}): DirectorDeps {
  const waitForJob = vi.fn((jobId: string) => {
    if (jobId === "speech-1") return Promise.resolve({ output: { audioUrl: AUDIO_URL } })
    if (jobId === "align-1") return Promise.resolve({ output: { alignment: ALIGNMENT } })
    if (jobId === "render-1") return Promise.resolve({ output: { videoUrl: VIDEO_URL } })
    return Promise.reject(new Error(`Unexpected jobId in mock: ${jobId}`))
  })

  const deps: DirectorDeps = {
    author: vi.fn().mockResolvedValue(MOCK_AUTHORED),
    createSpeechJob: vi.fn().mockResolvedValue({ jobId: "speech-1" }),
    createAlignmentJob: vi.fn().mockResolvedValue({ jobId: "align-1" }),
    createRenderJob: vi.fn().mockResolvedValue({ jobId: "render-1" }),
    waitForJob,
    onProgress: vi.fn(),
  }

  return { ...deps, ...overrides }
}

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
})

/**
 * Shared runVideoDirector test fixtures.
 *
 * The plain fixture DATA + the fully-mocked `buildDeps` helper are imported by
 * both orchestrate.test.ts and orchestrate-brand.test.ts (previously copy-pasted
 * verbatim between them). The per-file mock interception (vi.hoisted +
 * vi.mock("…/baker.js")) MUST stay in each test file — mocks are per-file — so
 * only this non-mock data + the deps factory live here.
 */
import { vi } from "vitest"
import type { DirectorDeps } from "../orchestrate.js"
import type { AuthoredSequence } from "../author.js"

export const AUDIO_URL = "https://cdn.example.com/speech.mp3"
export const VIDEO_URL = "https://cdn.example.com/result.mp4"
export const ALIGNMENT = [{ word: "Ship", start: 0.1, end: 0.4 }]
export const MOCK_PLAN = { planType: "shot-sequence", fps: 30 } // minimal; baker is mocked

export const MOCK_BRIEF_OBJ = {
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
export const MOCK_AUTHORED = {
  voScript: "Ship faster.",
  cues: [{ id: "c1", text: "Ship faster" }],
  shotSequenceBrief: MOCK_BRIEF_OBJ,
} as AuthoredSequence

export const BASE_OPTS = {
  genre: "explainer" as const,
  brief: "Nodaro MVP promo",
  userId: "u-test-1",
  tier: "pro",
}

/** Build fully-mocked director deps (author, speech, alignment, render, waitForJob). */
export function buildDeps(overrides: Partial<DirectorDeps> = {}): DirectorDeps {
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

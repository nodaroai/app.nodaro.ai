/**
 * Plans for the review inspector's panel, banner and footer tests, all over
 * the canvas's five-word transcript (review-test-canvas.tsx): So the thing um is.
 */
import { vi } from "vitest"
import { PLAN } from "./review-test-canvas"

/** Two fillers: "the" (450–850 ms) and "um" (4000–5000 ms). */
export const TWO_FILLERS = {
  ...PLAN,
  segments: [
    { id: "s0", inMs: 0, outMs: 450, video: "cam" },
    { id: "s1", inMs: 850, outMs: 4000, video: "cam" },
    { id: "s2", inMs: 5000, outMs: 9000, video: "cam" },
  ],
  dropped: [{ inMs: 450, outMs: 850, reason: "filler" }, { inMs: 4000, outMs: 5000, reason: "filler" }],
}

/** One segment, from the first word's start to the third's end: cutting those words keeps nothing. */
export const WORDS_ONLY = {
  ...PLAN,
  segments: [{ id: "s0", inMs: 100, outMs: 1300, video: "cam" }],
  dropped: [{ inMs: 1300, outMs: 9000, reason: "tangent" }],
}

/** Segments that overlap: the plan cannot be edited here. */
export const OVERLAPPING = {
  ...PLAN,
  segments: [
    { id: "s0", inMs: 0, outMs: 4000, video: "cam" },
    { id: "s1", inMs: 3000, outMs: 9000, video: "cam" },
  ],
  dropped: [],
}

const CAM_B = { id: "cam-b", url: "https://cdn.test/b.mp4", kind: "video", role: "camera", offsetMs: 700 }
const TWO_WORDS = { version: 1, words: [{ text: "early", startMs: 200, endMs: 600 }, { text: "late", startMs: 1200, endMs: 1600 }] }

/** cam-b starts 700 ms into the master clock and the plan dropped what came before: no restore of it passes. */
export const LOCKED_NO_PICTURE = {
  plan: {
    version: 1,
    clock: "master",
    sources: [CAM_B],
    segments: [{ id: "s0", inMs: 1000, outMs: 3000, video: "cam-b" }],
    dropped: [{ inMs: 0, outMs: 1000, reason: "no-picture" }],
  },
  transcript: TWO_WORDS,
}

/** The plan itself keeps time before cam-b starts: the render rule refuses it as made. */
export const BEFORE_SOURCE = {
  plan: {
    version: 1,
    clock: "master",
    sources: [CAM_B],
    segments: [{ id: "s0", inMs: 0, outMs: 3000, video: "cam-b" }],
    dropped: [],
  },
  transcript: TWO_WORDS,
}

/** A window below Tailwind's `sm` (640 px): every min-width query fails. */
export function narrowWindow(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: !/min-width/.test(query),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
}

import type { AlignmentWord } from "../../../providers/elevenlabs/forced-alignment.js"
import type { ShotSequenceBrief } from "../brief-schema.js"

/**
 * Shared baker test fixtures — the minimal 3-word alignment + a brief factory.
 * Imported by both baker.test.ts and baker-brand.test.ts so the fixture stays
 * defined once (it was previously copy-pasted verbatim between the two files).
 */
export const ALIGN: AlignmentWord[] = [
  { word: "ship", start: 0, end: 1 },
  { word: "faster", start: 1, end: 2 },
  { word: "today", start: 2, end: 3 },
]

/** Minimal shot-sequence brief; override any field per test. */
export function brief(overrides: Partial<ShotSequenceBrief> = {}): ShotSequenceBrief {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    backgroundColor: "#000",
    narration: { script: "ship faster today", cues: [{ id: "c1", text: "ship" }, { id: "c2", text: "today" }] },
    scenes: [
      {
        id: "s1",
        shots: [
          {
            id: "sh1",
            reveals: [
              { id: "r1", element: { id: "t1", type: "text", text: "Ship", fontFamily: "Inter", fontSize: 80, color: "#fff", x: 0, y: 0 }, revealAt: { kind: "cue", cueId: "c1", edge: "start" }, enter: { motion: "fade", durationFrames: 6 } },
              { id: "r2", element: { id: "t2", type: "text", text: "Today", fontFamily: "Inter", fontSize: 80, color: "#fff", x: 0, y: 100 }, revealAt: { kind: "cue", cueId: "c2", edge: "start" }, enter: { motion: "fade", durationFrames: 6 } },
            ],
          },
        ],
      },
    ],
    ...overrides,
  }
}

import { describe, it, expect } from "vitest"
import { shotSequenceBriefSchema } from "../brief-schema.js"

function makeBrief(overrides: Record<string, unknown> = {}) {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    backgroundColor: "#000000",
    narration: {
      script: "Ship faster with Nodaro.",
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
                element: { id: "t1", type: "text", text: "Ship faster", fontFamily: "Inter", fontSize: 90, color: "#fff", x: 100, y: 400 },
                revealAt: { kind: "cue", cueId: "c1", edge: "start" },
                enter: { motion: "fade", durationFrames: 10 },
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  }
}

describe("shotSequenceBriefSchema", () => {
  it("parses a valid brief", () => {
    expect(shotSequenceBriefSchema.safeParse(makeBrief()).success).toBe(true)
  })

  it("accepts a frame anchor", () => {
    const b = makeBrief()
    b.scenes[0].shots[0].reveals[0].revealAt = { kind: "frame", frame: 0 } as never
    expect(shotSequenceBriefSchema.safeParse(b).success).toBe(true)
  })

  it("requires at least one cue", () => {
    const b = makeBrief()
    b.narration.cues = []
    expect(shotSequenceBriefSchema.safeParse(b).success).toBe(false)
  })

  it("rejects an over-long script (DoS cap)", () => {
    expect(shotSequenceBriefSchema.safeParse(makeBrief({ narration: { script: "x".repeat(20_001), cues: [{ id: "c1", text: "x" }] } })).success).toBe(false)
  })
})

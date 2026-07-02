import { describe, it, expect } from "vitest"
import { shotSequenceBriefSchema, briefRevealSchema } from "../brief-schema.js"
import { shotElementSchema } from "../../../lib/plan-schemas.js"

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

// ── Blueprint reveals ─────────────────────────────────────────────────────

describe("briefRevealSchema — blueprint reveals", () => {
  it("accepts a blueprint reveal and rejects bad params", () => {
    const ok = briefRevealSchema.safeParse({
      id: "r1", revealAt: { kind: "cue", cueId: "c1", edge: "start" },
      blueprint: { id: "titlecard-reveal", params: { title: "Hello" } },
    })
    expect(ok.success).toBe(true)
    const bad = briefRevealSchema.safeParse({
      id: "r2", revealAt: { kind: "frame", frame: 0 },
      blueprint: { id: "titlecard-reveal", params: { subtitle: "no title" } },
    })
    expect(bad.success).toBe(false)
  })
  it("rejects a reveal with BOTH element and blueprint", () => {
    const r = briefRevealSchema.safeParse({
      id: "r3", revealAt: { kind: "frame", frame: 0 },
      element: { id: "t", type: "text", text: "x", fontFamily: "Inter", fontSize: 40, color: "#fff", x: 0, y: 0 },
      enter: { motion: "fade", durationFrames: 6 },
      blueprint: { id: "titlecard-reveal", params: { title: "x" } },
    })
    expect(r.success).toBe(false)
  })
  it("rejects a reveal with NEITHER element nor blueprint", () => {
    const r = briefRevealSchema.safeParse({ id: "r4", revealAt: { kind: "frame", frame: 0 } })
    expect(r.success).toBe(false)
  })
  it("rejects an unknown blueprint id", () => {
    const r = briefRevealSchema.safeParse({
      id: "r5", revealAt: { kind: "frame", frame: 0 }, blueprint: { id: "nope", params: {} },
    })
    expect(r.success).toBe(false)
  })
})

// ── Text element direction ───────────────────────────────────────────────

describe("shotElementSchema — text dir", () => {
  it("accepts dir on a text element and rejects a bad value", () => {
    const base = { id: "t1", type: "text" as const, text: "שלום", fontFamily: "Montserrat",
      fontSize: 80, color: "#fff", x: 0, y: 0 }
    expect(shotElementSchema.safeParse({ ...base, dir: "rtl" }).success).toBe(true)
    expect(shotElementSchema.safeParse({ ...base, dir: "sideways" }).success).toBe(false)
  })
})

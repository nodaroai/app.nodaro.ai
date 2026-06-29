import { describe, it, expect, vi } from "vitest"
import { authorShotSequence } from "../author.js"

const GOOD = {
  voScript: "Ship faster. Watch it appear.",
  cues: [
    { id: "c1", text: "Ship faster" },
    { id: "c2", text: "Watch it appear" },
  ],
  shotSequenceBrief: {
    fps: 30,
    width: 1920,
    height: 1080,
    backgroundColor: "#000",
    narration: {
      script: "Ship faster. Watch it appear.",
      cues: [
        { id: "c1", text: "Ship faster" },
        { id: "c2", text: "Watch it appear" },
      ],
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
                  text: "SHIP FASTER",
                  fontFamily: "Anton",
                  fontSize: 120,
                  color: "#fff",
                  x: 140,
                  y: 300,
                },
                revealAt: { kind: "cue", cueId: "c1", edge: "start" },
                enter: { motion: "slide-up", durationFrames: 12 },
              },
              {
                id: "r2",
                element: {
                  id: "e2",
                  type: "text",
                  text: "Watch it appear.",
                  fontFamily: "Anton",
                  fontSize: 90,
                  color: "#8B5CF6",
                  x: 140,
                  y: 600,
                },
                revealAt: { kind: "cue", cueId: "c2", edge: "start" },
                enter: { motion: "wipe-in", durationFrames: 14 },
              },
            ],
          },
        ],
      },
    ],
  },
}

describe("authorShotSequence", () => {
  it("returns a schema-valid authored sequence", async () => {
    const llm = vi.fn().mockResolvedValue({ text: JSON.stringify(GOOD), usage: {} })
    const r = await authorShotSequence({ genre: "explainer", brief: "x", userId: "u", tier: "pro", llm: llm as never })
    expect(r.cues.length).toBe(2)
    expect(r.shotSequenceBrief.scenes[0].shots[0].reveals[0].revealAt).toMatchObject({ kind: "cue", cueId: "c1" })
    for (const c of r.cues) expect(r.voScript).toContain(c.text)
  })

  it("retries once then throws AuthoringError on persistent bad JSON", async () => {
    const llm = vi.fn().mockResolvedValue({ text: "not json", usage: {} })
    await expect(
      authorShotSequence({ genre: "explainer", brief: "x", userId: "u", tier: "pro", llm: llm as never }),
    ).rejects.toThrow(/Authoring/)
    expect(llm).toHaveBeenCalledTimes(2)
  })

  it("retries once and resolves when second attempt returns good output", async () => {
    const llm = vi.fn()
      .mockResolvedValueOnce({ text: "not json", usage: {} })
      .mockResolvedValueOnce({ text: JSON.stringify(GOOD), usage: {} })
    const r = await authorShotSequence({ genre: "explainer", brief: "x", userId: "u", tier: "pro", llm: llm as never })
    expect(r.cues.length).toBe(2)
    expect(r.voScript).toBe(GOOD.voScript)
    expect(llm).toHaveBeenCalledTimes(2)
  })
})

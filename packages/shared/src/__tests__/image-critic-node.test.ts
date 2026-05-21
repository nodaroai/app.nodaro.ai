import { describe, it, expect } from "vitest"
import {
  IMAGE_CRITIC_LEAF_MODES,
  IMAGE_CRITIC_MODES,
  ImageCriticResultSchema,
} from "../image-critic-node.js"

describe("image-critic shared types", () => {
  it("IMAGE_CRITIC_LEAF_MODES contains 6 leaf modes (no 'all')", () => {
    expect(IMAGE_CRITIC_LEAF_MODES).toEqual([
      "character-consistency",
      "realism",
      "prompt-adherence",
      "anatomy",
      "aesthetic",
      "style-match",
    ])
    expect(IMAGE_CRITIC_LEAF_MODES).not.toContain("all")
  })

  it("IMAGE_CRITIC_MODES is leaves + 'all'", () => {
    expect(IMAGE_CRITIC_MODES).toHaveLength(7)
    expect(IMAGE_CRITIC_MODES).toContain("all")
  })

  it("parses a valid single-mode result", () => {
    const result = ImageCriticResultSchema.parse({
      score: 0.82,
      feedback: "Reshape the left hand.",
    })
    expect(result.score).toBe(0.82)
    expect(result.feedback).toBe("Reshape the left hand.")
  })

  it("parses a valid 'all'-mode result with perMode", () => {
    const result = ImageCriticResultSchema.parse({
      score: 0.55,
      feedback: "Anatomy: reshape the left hand.",
      perMode: {
        realism:  { score: 0.72, feedback: "Skin too plastic." },
        anatomy:  { score: 0.55, feedback: "Reshape the left hand." },
      },
    })
    expect(result.perMode?.anatomy?.score).toBe(0.55)
  })

  it("rejects 'all' as a perMode key (strict)", () => {
    expect(() =>
      ImageCriticResultSchema.parse({
        score: 0.5,
        feedback: "x",
        perMode: { all: { score: 0.5, feedback: "x" } } as any,
      }),
    ).toThrow()
  })

  it("rejects score outside 0-1", () => {
    expect(() => ImageCriticResultSchema.parse({ score: 1.5, feedback: "x" })).toThrow()
    expect(() => ImageCriticResultSchema.parse({ score: -0.1, feedback: "x" })).toThrow()
  })
})

import { describe, it, expect } from "vitest"
import { estimateWorkflowCredits } from "../credit-manager.js"

describe("credit-manager", () => {
  describe("estimateWorkflowCredits", () => {
    it("returns 0 for an empty array", () => {
      expect(estimateWorkflowCredits([])).toBe(0)
    })

    it("returns correct cost for a single known node type", () => {
      expect(estimateWorkflowCredits([{ type: "generate-image" }])).toBe(5)
    })

    it("returns correct cost for generate-script", () => {
      expect(estimateWorkflowCredits([{ type: "generate-script" }])).toBe(2)
    })

    it("returns correct cost for image-to-video", () => {
      expect(estimateWorkflowCredits([{ type: "image-to-video" }])).toBe(20)
    })

    it("returns correct cost for text-to-video", () => {
      expect(estimateWorkflowCredits([{ type: "text-to-video" }])).toBe(25)
    })

    it("returns correct cost for text-to-speech", () => {
      expect(estimateWorkflowCredits([{ type: "text-to-speech" }])).toBe(3)
    })

    it("returns 0 for an unknown node type", () => {
      expect(estimateWorkflowCredits([{ type: "nonexistent-node" }])).toBe(0)
    })

    it("returns 0 for multiple unknown node types", () => {
      const nodes = [
        { type: "unknown-a" },
        { type: "unknown-b" },
        { type: "unknown-c" },
      ]
      expect(estimateWorkflowCredits(nodes)).toBe(0)
    })

    it("sums costs for multiple mixed node types", () => {
      const nodes = [
        { type: "generate-script" },   // 2
        { type: "generate-image" },    // 5
        { type: "image-to-video" },    // 20
        { type: "text-to-speech" },    // 3
      ]
      expect(estimateWorkflowCredits(nodes)).toBe(30)
    })

    it("sums correctly with a mix of known and unknown nodes", () => {
      const nodes = [
        { type: "generate-image" },    // 5
        { type: "fake-node" },         // 0
        { type: "qa-check" },          // 1
      ]
      expect(estimateWorkflowCredits(nodes)).toBe(6)
    })

    it("returns correct cost for FFmpeg nodes", () => {
      const nodes = [
        { type: "adjust-volume" },  // 1
        { type: "trim-video" },     // 1
      ]
      expect(estimateWorkflowCredits(nodes)).toBe(2)
    })

    it("handles a large workflow with many nodes", () => {
      const nodes = [
        { type: "generate-script" },     // 2
        { type: "generate-image" },      // 5
        { type: "generate-image" },      // 5
        { type: "image-to-video" },      // 20
        { type: "video-to-video" },      // 25
        { type: "merge-video-audio" },   // 2
        { type: "combine-videos" },      // 3
        { type: "add-captions" },        // 3
        { type: "resize-video" },        // 2
        { type: "adjust-volume" },       // 1
        { type: "trim-video" },          // 1
      ]
      expect(estimateWorkflowCredits(nodes)).toBe(69)
    })

    it("does not mutate the input array", () => {
      const nodes = Object.freeze([
        Object.freeze({ type: "generate-image" }),
        Object.freeze({ type: "text-to-speech" }),
      ]) as ReadonlyArray<{ type: string }>
      // Should not throw due to mutation
      expect(estimateWorkflowCredits(nodes)).toBe(8)
    })
  })
})

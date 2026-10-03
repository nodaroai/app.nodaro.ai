/**
 * A video node's OWN Motion setting (`motionEnabled` + `motion`) in the
 * orchestrator's prompt — the `ownMotionHint` rule from @nodaro/prompts, which
 * the editor run and the prompt preview now share. Generate Video applies it in
 * both modes (its Motion control shows with or without a start frame); the
 * legacy Image to Video node applies it; a legacy Text to Video node has none.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"

const MOTION = { motionEnabled: true, motion: "dynamic" }

function node(type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id: `${type}-1`, type, data: { provider: "seedance-2", prompt: "a lighthouse in a storm", duration: 5, ...MOTION, ...data } }
}

function promptOf(n: SimpleNode, inputs: Record<string, unknown> = {}): string {
  const result = buildPayload(n, "job-own-motion", inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
  return String(result.payload.prompt)
}

describe("the node's own Motion setting in the orchestrator's prompt", () => {
  it("Generate Video with no start frame (text-to-video) carries it", () => {
    expect(promptOf(node("generate-video"))).toContain("a lighthouse in a storm. dynamic motion")
  })

  it("Generate Video with a start frame (image-to-video) carries it", () => {
    expect(promptOf(node("generate-video"), { startFrameUrl: "https://cdn.example/start.png" })).toContain("dynamic motion")
  })

  it("the legacy Image to Video node carries it", () => {
    expect(promptOf(node("image-to-video"), { imageUrl: "https://cdn.example/start.png" })).toContain("dynamic motion")
  })

  it("the legacy Text to Video node has no such setting", () => {
    expect(promptOf(node("text-to-video"))).not.toContain("motion")
  })

  it("an enabled setting with no step stored runs as the step the panel shows (Moderate)", () => {
    expect(promptOf(node("generate-video", { motion: undefined }))).toContain("moderate motion")
  })

  it("nothing is added while the setting is off", () => {
    expect(promptOf(node("generate-video", { motionEnabled: false }))).not.toContain("motion")
  })
})

import { describe, it, expect } from "vitest"
import {
  videoImageGateBlocked,
  VIDEO_IMAGE_START_FRAME_HANDLES,
  VIDEO_IMAGE_REF_HANDLES,
  VIDEO_IMAGE_VIDEO_REF_HANDLES,
} from "../video-image-gate"

const gvNode = (provider: string) => ({ id: "n1", type: "generate-video", data: { provider } })
const edge = (targetHandle: string) => ({ target: "n1", targetHandle })

describe("videoImageGateBlocked", () => {
  it("blocks an i2v-only model with nothing wired", () => {
    expect(videoImageGateBlocked(gvNode("kling-3-omni"), [])).toBe(true)
    expect(videoImageGateBlocked(gvNode("hailuo-2.3"), [])).toBe(true)
  })

  it("does not block a text-capable model", () => {
    expect(videoImageGateBlocked(gvNode("veo3"), [])).toBe(false)
    expect(videoImageGateBlocked(gvNode("seedance-2"), [])).toBe(false)
  })

  it("lifts on any start-frame handle", () => {
    for (const handle of VIDEO_IMAGE_START_FRAME_HANDLES) {
      expect(
        videoImageGateBlocked(gvNode("kling-3-omni"), [edge(handle)]),
        `handle ${handle} should lift the gate`,
      ).toBe(false)
    }
  })

  it("does NOT lift on references alone for a single-id i2v-only model", () => {
    // Engine parity: resolveVideoModeForInputs sends a refs-only single-id
    // model to text-to-video, and payload-builder then throws. Lifting here
    // would let the user press Run into a guaranteed failure.
    for (const handle of VIDEO_IMAGE_REF_HANDLES) {
      expect(
        videoImageGateBlocked(gvNode("kling-3-omni"), [edge(handle)]),
        `refs on ${handle} must not lift the gate for a single-id model`,
      ).toBe(true)
    }
  })

  it("DOES lift on references alone for a split-id model whose i2v twin carries them", () => {
    // grok-i2v: refs-only resolves to image-to-video, so the run succeeds.
    expect(videoImageGateBlocked(gvNode("grok-i2v"), [edge("imageReferences")])).toBe(false)
  })

  it("lifts on a video reference alone for the Gemini Omni family (V2V override)", () => {
    // Engine parity: execute-node.ts / payload-builder.ts both force
    // image-to-video for isGeminiOmniProvider(provider) && hasVideoRef,
    // regardless of what resolveVideoModeForInputs would otherwise resolve.
    for (const handle of VIDEO_IMAGE_VIDEO_REF_HANDLES) {
      expect(
        videoImageGateBlocked(gvNode("gemini-omni-video"), [edge(handle)]),
        `video ref on ${handle} should lift the gate for gemini-omni-video`,
      ).toBe(false)
      expect(
        videoImageGateBlocked(gvNode("gemini-omni-flash"), [edge(handle)]),
        `video ref on ${handle} should lift the gate for gemini-omni-flash`,
      ).toBe(false)
    }
  })

  it("does NOT lift on a video reference alone for a non-gemini-omni image-required provider", () => {
    // The override is family-scoped: an i2v-only model outside the Gemini
    // Omni family still resolves to text-to-video (resolveVideoModeForInputs
    // has no idea about video refs) and stays blocked.
    for (const handle of VIDEO_IMAGE_VIDEO_REF_HANDLES) {
      expect(
        videoImageGateBlocked(gvNode("kling-3-omni"), [edge(handle)]),
        `video ref on ${handle} must not lift the gate for a non-gemini-omni provider`,
      ).toBe(true)
    }
  })

  it("ignores edges into other handles and other nodes", () => {
    expect(videoImageGateBlocked(gvNode("kling-3-omni"), [edge("prompt")])).toBe(true)
    expect(
      videoImageGateBlocked(gvNode("kling-3-omni"), [{ target: "n2", targetHandle: "startFrame" }]),
    ).toBe(true)
  })

  it("never blocks a node that is not a generate-video node", () => {
    expect(videoImageGateBlocked({ id: "n1", type: "image-to-video", data: { provider: "kling-3-omni" } }, [])).toBe(false)
    expect(videoImageGateBlocked(undefined, [])).toBe(false)
    expect(videoImageGateBlocked({ id: "n1", type: "generate-video", data: {} }, [])).toBe(false)
  })
})

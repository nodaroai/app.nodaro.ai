/**
 * B4b — PromptPolicy applied at the orchestrator image-assembly sites.
 *
 * buildPayload folds any registered PromptPolicy over the server-authoritative
 * image prompt at BOTH assembly funnels: `assembleImageInput` (generate-image)
 * and `buildImagePrompt` (image-to-image / modify). With no policy registered
 * the transform is the identity, so mainline is byte-identical.
 */
import { describe, it, expect, afterEach } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"
import { registerPromptPolicy, clearPromptPolicies } from "../../../lib/prompt-policy.js"

afterEach(() => clearPromptPolicies())

const imageSuffix = () =>
  registerPromptPolicy({
    id: "test-image-suffix",
    apply: (a) => (a.kind === "image" ? { ...a, prompt: `${a.prompt} SUFFIX` } : a),
  })

describe("buildPayload — PromptPolicy at image assembly (B4b)", () => {
  it("applies a registered policy to the generate-image prompt (assembleImageInput funnel)", () => {
    imageSuffix()
    const n: SimpleNode = { id: "gi-1", type: "generate-image", data: { provider: "nano-banana", prompt: "a red bird" } }
    const result = buildPayload(n, "job-1", {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
    expect(result.payload.prompt).toBe("a red bird SUFFIX")
  })

  it("applies a registered policy to the image-to-image prompt (buildImagePrompt funnel)", () => {
    imageSuffix()
    const n: SimpleNode = {
      id: "i2i-1",
      type: "image-to-image",
      data: { provider: "flux-i2i", prompt: "make it night", imageUrl: "https://r2/main.png" },
    }
    const result = buildPayload(n, "job-2", { imageUrl: "https://r2/main.png" }, undefined, {
      nodes: [n],
      edges: [],
      nodeStates: {},
    })
    expect(result.jobName).toBe("image-to-image")
    expect(result.payload.prompt as string).toContain("make it night SUFFIX")
  })

  it("applies a registered policy to the edit-image prompt", () => {
    imageSuffix()
    const n: SimpleNode = {
      id: "ei-1",
      type: "edit-image",
      data: { provider: "nano-banana-edit", prompt: "add a hat", imageUrl: "https://r2/main.png" },
    }
    const result = buildPayload(n, "job-ei", { imageUrl: "https://r2/main.png" }, undefined, {
      nodes: [n],
      edges: [],
      nodeStates: {},
    })
    expect(result.jobName).toBe("edit-image")
    expect(result.payload.prompt as string).toBe("add a hat SUFFIX")
  })

  it("is byte-identical for edit-image when no policy is registered (inert default)", () => {
    const n: SimpleNode = {
      id: "ei-2",
      type: "edit-image",
      data: { provider: "nano-banana-edit", prompt: "add a hat", imageUrl: "https://r2/main.png" },
    }
    const result = buildPayload(n, "job-ei2", { imageUrl: "https://r2/main.png" }, undefined, {
      nodes: [n],
      edges: [],
      nodeStates: {},
    })
    expect(result.payload.prompt).toBe("add a hat")
  })

  it("applies a registered policy at the video funnel (composeVideoPrompt)", () => {
    registerPromptPolicy({
      id: "test-video-suffix",
      apply: (a) => (a.kind === "video" ? { ...a, prompt: `${a.prompt} VID` } : a),
    })
    const n: SimpleNode = { id: "i2v-1", type: "image-to-video", data: { provider: "kling", prompt: "a dog runs" } }
    const result = buildPayload(n, "job-v", { imageUrl: "https://r2/img.png" }, undefined, {
      nodes: [n],
      edges: [],
      nodeStates: {},
    })
    expect(result.jobName).toBe("image-to-video")
    expect(result.payload.prompt as string).toBe("a dog runs VID")
  })

  it("is byte-identical when no policy is registered (inert default)", () => {
    const n: SimpleNode = { id: "gi-2", type: "generate-image", data: { provider: "nano-banana", prompt: "a red bird" } }
    const result = buildPayload(n, "job-3", {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
    expect(result.payload.prompt).toBe("a red bird")
  })
})

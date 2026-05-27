import { describe, expect, it } from "vitest"
import { getHandleConnectionLimit } from "../handle-limits"
import type { WorkflowNode } from "@/types/nodes"

describe("getHandleConnectionLimit (generate-video)", () => {
  it("returns endFrame cap 1 for providers in PROVIDERS_WITH_END_FRAME", () => {
    // veo3.1 is in the end-frame catalog set.
    const node = {
      id: "n",
      type: "generate-video",
      data: { provider: "veo3.1" },
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "endFrame")?.limit).toBe(1)
  })

  it("returns endFrame cap 0 for providers without end-frame support", () => {
    // "kling" (2.6) only declares ["audio"] in MODEL_CATALOG.features — no
    // end-frame, so the cap must be 0.
    const node = {
      id: "n",
      type: "generate-video",
      data: { provider: "kling" },
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "endFrame")?.limit).toBe(0)
  })

  it("returns startFrame cap 1 for any provider", () => {
    const node = {
      id: "n",
      type: "generate-video",
      data: { provider: "kling" },
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "startFrame")?.limit).toBe(1)
  })

  it("returns audio cap 1 for any provider", () => {
    const node = {
      id: "n",
      type: "generate-video",
      data: { provider: "kling" },
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "audio")?.limit).toBe(1)
  })

  it("returns audioReferences cap from VIDEO_REF_LIMITS_BY_PROVIDER for seedance-2-fast", () => {
    const node = {
      id: "n",
      type: "generate-video",
      data: { provider: "seedance-2-fast" },
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "audioReferences")?.limit).toBeGreaterThan(0)
  })

  it("returns videoReferences cap 0 for provider absent from VIDEO_REF_LIMITS_BY_PROVIDER", () => {
    // kling is NOT in VIDEO_REF_LIMITS_BY_PROVIDER -> caps null -> 0.
    const node = {
      id: "n",
      type: "generate-video",
      data: { provider: "kling" },
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "videoReferences")?.limit).toBe(0)
  })

  it("returns imageReferences cap for seedance-2-fast in references mode (multimodal references)", () => {
    // seedance-2-fast is in PROVIDERS_WITH_REFERENCES AND has caps.images = 9.
    // Mode must be "references" — in the default "frames" mode the
    // mutually-exclusive toggle forces imageReferences to 0.
    const node = {
      id: "n",
      type: "generate-video",
      data: { provider: "seedance-2-fast", seedance2InputMode: "references" },
    } as unknown as WorkflowNode
    const result = getHandleConnectionLimit(node, "imageReferences")
    expect(result?.limit).toBeGreaterThan(1)
  })

  it("seedance-2 frames mode disables imageReferences (mutually exclusive with start/end frames)", () => {
    const node = {
      id: "n",
      type: "generate-video",
      data: { provider: "seedance-2-fast", seedance2InputMode: "frames" },
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "imageReferences")?.limit).toBe(0)
    expect(getHandleConnectionLimit(node, "startFrame")?.limit).toBe(1)
  })

  it("seedance-2 references mode disables startFrame + endFrame", () => {
    const node = {
      id: "n",
      type: "generate-video",
      data: { provider: "seedance-2-fast", seedance2InputMode: "references" },
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "startFrame")?.limit).toBe(0)
    expect(getHandleConnectionLimit(node, "endFrame")?.limit).toBe(0)
  })

  it("returns null for unknown handle on generate-video", () => {
    const node = {
      id: "n",
      type: "generate-video",
      data: { provider: "kling" },
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "look")).toBeNull()
  })

  it("falls back to kling when no provider is set", () => {
    const node = {
      id: "n",
      type: "generate-video",
      data: {},
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "startFrame")?.limit).toBe(1)
  })

  it("does NOT affect generate-image dispatch", () => {
    const node = {
      id: "n",
      type: "generate-image",
      data: { provider: "nano-banana-pro" },
    } as unknown as WorkflowNode
    // generate-image only returns non-null for handleId === "references"
    expect(getHandleConnectionLimit(node, "startFrame")).toBeNull()
  })
})

/**
 * "Add AI finish" only works if the new Modify Image node is fed BOTH the
 * composite and the ring mask, on a provider that actually takes a mask —
 * a missing edge or a maskless provider turns the one-click chain into a
 * plain re-edit of the whole picture.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { I2I_MASK_SUPPORT, MODIFY_IMAGE_PROVIDERS } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useImageOverlayAiFinish, AI_FINISH_PROMPT } from "../use-image-overlay-ai-finish"

describe("useImageOverlayAiFinish", () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      isReadOnly: false,
      nodes: [
        { id: "ov", type: "image-overlay", position: { x: 100, y: 50 }, width: 600, data: { layers: [], maskMode: "none" } },
      ],
      edges: [],
    } as never)
  })

  it("adds a mask-capable Modify Image node wired to both outputs and forces the ring mask", () => {
    const { result } = renderHook(() => useImageOverlayAiFinish("ov"))
    const targetId = result.current.addAiFinish()
    expect(targetId).toBeTruthy()

    const state = useWorkflowStore.getState()
    const target = state.nodes.find((n) => n.id === targetId)
    expect(target?.type).toBe("modify-image")
    const data = target?.data as { provider: string; prompt: string }
    expect(data.prompt).toBe(AI_FINISH_PROMPT)
    expect((MODIFY_IMAGE_PROVIDERS as readonly string[]).includes(data.provider)).toBe(true)
    expect(I2I_MASK_SUPPORT.has(data.provider)).toBe(true)

    const wires = state.edges
      .filter((e) => e.source === "ov" && e.target === targetId)
      .map((e) => [e.sourceHandle, e.targetHandle])
      .sort()
    expect(wires).toEqual([["image", "image"], ["mask", "mask"]])

    const source = state.nodes.find((n) => n.id === "ov")
    expect((source?.data as { maskMode?: string }).maskMode).toBe("around")
    expect(target?.position.x).toBeGreaterThan(100 + 600)
  })

  it("returns null and adds nothing for an unknown node", () => {
    const { result } = renderHook(() => useImageOverlayAiFinish("nope"))
    expect(result.current.addAiFinish()).toBeNull()
    expect(useWorkflowStore.getState().nodes).toHaveLength(1)
  })
})

import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: vi.fn(() => "mock scene prompt"),
}))

import { resolveFieldMappings } from "../resolve-field-mappings"
import { NODE_MAPPABLE_FIELDS } from "@nodaro-shared/node-mappable-fields"
import type { WorkflowNode } from "@/types/nodes"

describe("mapped cinematography parameters flow end-to-end on I2V", () => {
  it("mapped cameraMotion flows through", () => {
    const cmNode = {
      id: "cm-1",
      type: "camera-motion",
      position: { x: 0, y: 0 },
      data: { label: "Camera Motion", cameraMotion: "orbit-right" },
    } as WorkflowNode

    const i2vData = {
      prompt: "a dog",
      cameraMotionEnabled: true,
      cameraMotion: undefined,
      fieldMappings: { cameraMotion: { sourceNodeId: "cm-1" } },
    }

    const resolved = resolveFieldMappings(
      i2vData,
      [cmNode],
      undefined,
      NODE_MAPPABLE_FIELDS["image-to-video"],
    )
    expect(resolved.cameraMotion).toBe("orbit-right")
  })

  it("framing is no longer a mappable field on consumer nodes (multi-category data lives only on consumer.shotSize/angle/etc.)", () => {
    const mappableFields = NODE_MAPPABLE_FIELDS["image-to-video"]
    expect(mappableFields).not.toContain("framing")
  })
})

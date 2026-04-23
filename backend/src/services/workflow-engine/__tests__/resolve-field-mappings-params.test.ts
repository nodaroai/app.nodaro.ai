import { describe, it, expect } from "vitest"
import { resolveFieldMappings } from "../resolve-field-mappings.js"
import type { NodeExecutionState, SimpleNode } from "../types.js"

describe("resolveFieldMappings — parameter node sources", () => {
  it("resolves cameraMotion id from a standalone camera-motion node", () => {
    const sourceNode: SimpleNode = {
      id: "cm-1",
      type: "camera-motion",
      data: { cameraMotion: "orbit-right", label: "Camera Motion" },
    }
    const i2vData = {
      fieldMappings: { cameraMotion: { sourceNodeId: "cm-1" } },
      cameraMotionEnabled: true,
    }
    const resolved = resolveFieldMappings(
      i2vData,
      {},
      [sourceNode],
      undefined,
      ["cameraMotion"],
    )
    expect(resolved.cameraMotion).toBe("orbit-right")
  })

  it("preserves existing text-field behavior (prompt via state.output)", () => {
    const promptNode: SimpleNode = {
      id: "p-1",
      type: "text-prompt",
      data: { text: "a dog", label: "Prompt" },
    }
    const nodeStates = {
      "p-1": { nodeType: "text-prompt", output: { text: "a dog" } } as NodeExecutionState,
    }
    const resolved = resolveFieldMappings(
      { fieldMappings: { prompt: { sourceNodeId: "p-1" } } },
      nodeStates,
      [promptNode],
      undefined,
      ["prompt"],
    )
    expect(resolved.prompt).toBe("a dog")
  })
})

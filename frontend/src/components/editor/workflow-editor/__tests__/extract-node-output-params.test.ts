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

import { extractNodeOutput } from "../execution-graph"
import type { WorkflowNode } from "@/types/nodes"

function makeNode<T extends Record<string, unknown>>(type: string, data: T): WorkflowNode {
  return {
    id: `${type}-1`,
    type,
    position: { x: 0, y: 0 },
    data: { label: type, ...data } as never,
  } as WorkflowNode
}

describe("extractNodeOutput — parameter nodes", () => {
  it("returns first set per-category framing id for framing nodes (multi-category)", () => {
    expect(extractNodeOutput(makeNode("framing", { shotSize: "close-up" }))).toBe("close-up")
  })
  it("returns cameraMotion id for camera-motion nodes", () => {
    expect(extractNodeOutput(makeNode("camera-motion", { cameraMotion: "orbit-right" }))).toBe("orbit-right")
  })
  it("returns motion value for motion nodes", () => {
    expect(extractNodeOutput(makeNode("motion", { motion: "moderate" }))).toBe("moderate")
  })
  it("returns tone value for tone nodes", () => {
    expect(extractNodeOutput(makeNode("tone", { tone: "dramatic" }))).toBe("dramatic")
  })
})

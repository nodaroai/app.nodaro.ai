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
  // Parameter nodes now emit their FULL prompt hint (not the bare picker id)
  // so text consumers (Combine Text, LLM Chat, gen nodes' prompt handle) see
  // the same rich clause that the cinematography handle would inject.
  // Field-mapping resolution bypasses extractNodeOutput and reads
  // getParameterValue directly when it needs the bare id.
  it("returns rich prompt hint for framing nodes (multi-category)", () => {
    const out = extractNodeOutput(makeNode("framing", { shotSize: "close-up" }))
    expect(out).toBeDefined()
    // buildFramingHints emits a descriptive clause for `close-up`
    expect(out!.toLowerCase()).toContain("close")
  })
  it("returns rich motion hint for camera-motion nodes", () => {
    const out = extractNodeOutput(makeNode("camera-motion", { cameraMotion: "orbit-right" }))
    expect(out).toBeDefined()
    // composeCameraMotionHintFromConnections returns the motion's prompt hint
    expect(out!.toLowerCase()).toContain("orbit")
  })
  it("returns undefined for legacy motion nodes (no hint generator)", () => {
    // Legacy `motion` dim isn't in getParameterPromptHint. Field mappings
    // still read the bare value via getParameterValue.
    expect(extractNodeOutput(makeNode("motion", { motion: "moderate" }))).toBeUndefined()
  })
  it("returns tone value for tone nodes", () => {
    expect(extractNodeOutput(makeNode("tone", { tone: "dramatic" }))).toBe("dramatic")
  })
})

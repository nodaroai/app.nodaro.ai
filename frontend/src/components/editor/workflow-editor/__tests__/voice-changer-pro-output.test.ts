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

describe("extractNodeOutput voice-changer-pro", () => {
  const data = {
    generatedVideoUrl: "https://r2/out.mp4",
    generatedAudioUrl: "https://r2/out.mp3",
    generatedResults: [],
    activeResultIndex: 0,
  }
  it("returns the video URL on the video handle", () => {
    expect(extractNodeOutput(makeNode("voice-changer-pro", data), "video")).toBe("https://r2/out.mp4")
  })
  it("returns the audio URL on the audio handle", () => {
    expect(extractNodeOutput(makeNode("voice-changer-pro", data), "audio")).toBe("https://r2/out.mp3")
  })
  it("falls back to videoUrl when no sourceHandle and results is empty", () => {
    expect(extractNodeOutput(makeNode("voice-changer-pro", data))).toBe("https://r2/out.mp4")
  })
  it("falls back to audioUrl when no sourceHandle and no videoUrl and results is empty", () => {
    const audioOnly = { ...data, generatedVideoUrl: undefined }
    expect(extractNodeOutput(makeNode("voice-changer-pro", audioOnly))).toBe("https://r2/out.mp3")
  })
})

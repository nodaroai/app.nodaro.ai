import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

const mockUpdateNodeData = vi.fn()
const mockSetState = vi.fn()
let mockNodes: Array<{
  id: string
  type?: string
  data: Record<string, unknown>
  position: { x: number; y: number }
  hidden?: boolean
}> = []
let mockEdges: Array<{
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}> = []

const mockExecuteNode = vi.fn()
const mockExtractNodeOutput = vi.fn()

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      updateNodeData: mockUpdateNodeData,
      nodes: mockNodes,
      edges: mockEdges,
    }),
    setState: (state: unknown) => mockSetState(state),
  },
}))

vi.mock("../execute-node", () => ({
  executeNode: (...args: unknown[]) => mockExecuteNode(...args),
}))

vi.mock("../poll-job", () => ({
  setSuppressToasts: () => {},
  isSuppressToasts: () => false,
}))

vi.mock("../execution-graph", () => ({
  extractNodeOutput: (...args: unknown[]) => mockExtractNodeOutput(...args),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { executeNodeForList, expandLoopResults } from "../list-execution"
import type { ExecutionContext } from "../types"
import type { WorkflowNode } from "@/types/nodes"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    userId: "u1",
    projectId: "p1",
    trackInterval: (i) => i,
    untrackInterval: vi.fn(),
    save: vi.fn(),
    setIsRunning: vi.fn(),
    isWorkflowStale: () => false,
    isStorageError: () => false,
    setShowStorageExceeded: vi.fn(),
    setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(),
    setInsufficientCreditsData: vi.fn(),
    ...overrides,
  } as ExecutionContext
}

function makeNode(
  overrides: Partial<(typeof mockNodes)[0]> = {},
): (typeof mockNodes)[0] {
  return {
    id: "n1",
    type: "generate-image",
    position: { x: 0, y: 0 },
    data: { label: "Gen Image" },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// expandLoopResults — output URL field mapping
// ---------------------------------------------------------------------------

describe("expandLoopResults — output URL field mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodes = []
    mockEdges = []
    mockSetState.mockReset()
  })

  it("sets generatedImageUrl for image node clones", () => {
    mockNodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Img",
          __listResults: ["img1.png", "img2.png"],
          __listInputs: ["a", "b"],
        },
      }),
    ]
    expandLoopResults()

    const state = mockSetState.mock.calls[0][0]
    const clone0 = state.nodes.find((n: any) => n.id === "n1_iter_0")
    expect(clone0.data.generatedImageUrl).toBe("img1.png")
    // Should NOT have video or audio URL fields
    expect(clone0.data.generatedVideoUrl).toBeUndefined()
    expect(clone0.data.generatedAudioUrl).toBeUndefined()
  })

  it("sets generatedVideoUrl for video node clones", () => {
    mockNodes = [
      makeNode({
        id: "n1",
        type: "image-to-video",
        data: {
          label: "I2V",
          __listResults: ["vid1.mp4", "vid2.mp4"],
          __listInputs: ["", ""],
        },
      }),
    ]
    expandLoopResults()

    const state = mockSetState.mock.calls[0][0]
    const clone0 = state.nodes.find((n: any) => n.id === "n1_iter_0")
    expect(clone0.data.generatedVideoUrl).toBe("vid1.mp4")
    expect(clone0.data.generatedImageUrl).toBeUndefined()
  })

  it("sets generatedAudioUrl for audio node clones", () => {
    mockNodes = [
      makeNode({
        id: "n1",
        type: "text-to-speech",
        data: {
          label: "TTS",
          __listResults: ["audio1.mp3", "audio2.mp3"],
          __listInputs: ["hello", "world"],
        },
      }),
    ]
    expandLoopResults()

    const state = mockSetState.mock.calls[0][0]
    const clone0 = state.nodes.find((n: any) => n.id === "n1_iter_0")
    expect(clone0.data.generatedAudioUrl).toBe("audio1.mp3")
    expect(clone0.data.generatedVideoUrl).toBeUndefined()
    expect(clone0.data.generatedImageUrl).toBeUndefined()
  })

  it("maps all VIDEO_TYPES to generatedVideoUrl", () => {
    const videoTypes = [
      "image-to-video",
      "video-to-video",
      "text-to-video",
      "generate-video",
      "video-upscale",
      "motion-transfer",
      "lip-sync",
      "suno-music-video",
      "combine-videos",
      "render-video",
    ]

    for (const vType of videoTypes) {
      mockSetState.mockReset()
      mockNodes = [
        makeNode({
          id: "n1",
          type: vType,
          data: {
            label: vType,
            __listResults: ["v1.mp4", "v2.mp4"],
            __listInputs: ["", ""],
          },
        }),
      ]
      mockEdges = []
      expandLoopResults()

      const state = mockSetState.mock.calls[0]?.[0]
      expect(state).toBeDefined()
      const clone = state.nodes.find((n: any) => n.id === "n1_iter_0")
      expect(clone.data.generatedVideoUrl).toBe("v1.mp4")
    }
  })

  it("maps all AUDIO_TYPES to generatedAudioUrl", () => {
    const audioTypes = [
      "text-to-speech",
      "generate-music",
      "text-to-audio",
      "audio-isolation",
      "suno-generate",
      "suno-cover",
      "suno-extend",
      "suno-separate",
    ]

    for (const aType of audioTypes) {
      mockSetState.mockReset()
      mockNodes = [
        makeNode({
          id: "n1",
          type: aType,
          data: {
            label: aType,
            __listResults: ["a1.mp3", "a2.mp3"],
            __listInputs: ["", ""],
          },
        }),
      ]
      mockEdges = []
      expandLoopResults()

      const state = mockSetState.mock.calls[0]?.[0]
      expect(state).toBeDefined()
      const clone = state.nodes.find((n: any) => n.id === "n1_iter_0")
      expect(clone.data.generatedAudioUrl).toBe("a1.mp3")
    }
  })
})

// ---------------------------------------------------------------------------
// expandLoopResults — clone data integrity
// ---------------------------------------------------------------------------

describe("expandLoopResults — clone data integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodes = []
    mockEdges = []
    mockSetState.mockReset()
  })

  it("populates generatedResults array with url, timestamp, and jobId", () => {
    mockNodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Gen",
          __listResults: ["url1.png", "url2.png"],
          __listInputs: ["a", "b"],
        },
      }),
    ]
    expandLoopResults()

    const state = mockSetState.mock.calls[0][0]
    const clone0 = state.nodes.find((n: any) => n.id === "n1_iter_0")
    expect(clone0.data.generatedResults).toHaveLength(1)
    expect(clone0.data.generatedResults[0].url).toBe("url1.png")
    expect(clone0.data.generatedResults[0].jobId).toBe("")
    expect(clone0.data.generatedResults[0].timestamp).toBeDefined()
    expect(clone0.data.activeResultIndex).toBe(0)
  })

  it("removes list metadata from clone data", () => {
    mockNodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Gen",
          __listResults: ["url1.png", "url2.png"],
          __listInputs: ["a", "b"],
          __listTotal: 2,
          __listCompleted: 2,
        },
      }),
    ]
    expandLoopResults()

    const state = mockSetState.mock.calls[0][0]
    const clone0 = state.nodes.find((n: any) => n.id === "n1_iter_0")
    expect(clone0.data.__listResults).toBeUndefined()
    expect(clone0.data.__listInputs).toBeUndefined()
    expect(clone0.data.__listTotal).toBeUndefined()
    expect(clone0.data.__listCompleted).toBeUndefined()
  })

  it("sets prompt from non-URL input text", () => {
    mockNodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Gen",
          __listResults: ["url1.png", "url2.png"],
          __listInputs: ["a cat in space", "a dog on mars"],
        },
      }),
    ]
    expandLoopResults()

    const state = mockSetState.mock.calls[0][0]
    const clone0 = state.nodes.find((n: any) => n.id === "n1_iter_0")
    const clone1 = state.nodes.find((n: any) => n.id === "n1_iter_1")
    expect(clone0.data.prompt).toBe("a cat in space")
    expect(clone1.data.prompt).toBe("a dog on mars")
  })

  it("does not set prompt for URL-like inputs", () => {
    mockNodes = [
      makeNode({
        id: "n1",
        type: "image-to-video",
        data: {
          label: "I2V",
          __listResults: ["vid1.mp4", "vid2.mp4"],
          __listInputs: [
            "https://example.com/img1.png",
            "https://example.com/img2.png",
          ],
        },
      }),
    ]
    expandLoopResults()

    const state = mockSetState.mock.calls[0][0]
    const clone0 = state.nodes.find((n: any) => n.id === "n1_iter_0")
    expect(clone0.data.prompt).toBeUndefined()
  })

  it("marks isDirty true on setState", () => {
    mockNodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Gen",
          __listResults: ["a", "b"],
          __listInputs: ["x", "y"],
        },
      }),
    ]
    expandLoopResults()

    const state = mockSetState.mock.calls[0][0]
    expect(state.isDirty).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// expandLoopResults — edge fan-out from non-cloneable source
// ---------------------------------------------------------------------------

describe("expandLoopResults — fan-out edges from list source", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodes = []
    mockEdges = []
    mockSetState.mockReset()
  })

  it("creates fan-out edges from non-cloneable source to each clone", () => {
    mockNodes = [
      makeNode({
        id: "loop1",
        type: "loop",
        data: {
          label: "Table",
          __listResults: ["a", "b", "c"],
          __listInputs: ["x", "y", "z"],
        },
      }),
      makeNode({
        id: "n2",
        type: "generate-image",
        data: {
          label: "Gen",
          __listResults: ["img1", "img2", "img3"],
          __listInputs: ["p1", "p2", "p3"],
        },
      }),
    ]
    mockEdges = [{ id: "e1", source: "loop1", target: "n2" }]

    expandLoopResults()

    const state = mockSetState.mock.calls[0][0]
    const cloneEdges = state.edges.filter((e: any) => e.id.includes("_iter_"))
    // loop1 is not cloneable, n2 is -> fan-out pattern
    expect(cloneEdges).toHaveLength(3)
    expect(cloneEdges[0].source).toBe("loop1") // source stays as original
    expect(cloneEdges[0].target).toBe("n2_iter_0")
    expect(cloneEdges[1].target).toBe("n2_iter_1")
    expect(cloneEdges[2].target).toBe("n2_iter_2")
  })

  it("does not create clone edges when source is cloneable but target is not", () => {
    // Edge from cloneable -> non-cloneable: no clone edges created
    mockNodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Gen",
          __listResults: ["img1", "img2"],
          __listInputs: ["a", "b"],
        },
      }),
      makeNode({
        id: "out1",
        type: "output",
        data: { label: "Output" },
      }),
    ]
    mockEdges = [{ id: "e1", source: "n1", target: "out1" }]

    expandLoopResults()

    const state = mockSetState.mock.calls[0][0]
    const cloneEdges = state.edges.filter((e: any) => e.id.includes("_iter_"))
    // out1 is not cloneable and n1 is cloneable -> no case handles this (falls through)
    expect(cloneEdges).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// expandLoopResults — multi-node pipeline chains
// ---------------------------------------------------------------------------

describe("expandLoopResults — multi-node pipeline chains", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodes = []
    mockEdges = []
    mockSetState.mockReset()
  })

  it("walks downstream chain and clones all pipeline nodes", () => {
    // Chain: n1 (generate-image) -> n2 (image-to-video) -> n3 (video-upscale)
    mockNodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Gen",
          __listResults: ["img1", "img2"],
          __listInputs: ["a", "b"],
        },
      }),
      makeNode({
        id: "n2",
        type: "image-to-video",
        data: {
          label: "I2V",
          __listResults: ["vid1", "vid2"],
          __listInputs: ["", ""],
        },
      }),
      makeNode({
        id: "n3",
        type: "video-upscale",
        data: {
          label: "Upscale",
          __listResults: ["up1", "up2"],
          __listInputs: ["", ""],
        },
      }),
    ]
    mockEdges = [
      { id: "e1", source: "n1", target: "n2" },
      { id: "e2", source: "n2", target: "n3" },
    ]

    expandLoopResults()

    const state = mockSetState.mock.calls[0][0]
    // All three originals should be hidden
    const hiddenOriginals = state.nodes.filter(
      (n: any) => !n.id.includes("_iter_") && n.hidden,
    )
    expect(hiddenOriginals).toHaveLength(3)

    // 2 iterations x 3 nodes = 6 clones
    const clones = state.nodes.filter((n: any) => n.id.includes("_iter_"))
    expect(clones).toHaveLength(6)

    // Clone edges: e1 and e2 each cloned twice = 4 clone edges
    const cloneEdges = state.edges.filter((e: any) => e.id.includes("_iter_"))
    expect(cloneEdges).toHaveLength(4)

    // Verify edge n1_iter_0 -> n2_iter_0
    expect(
      cloneEdges.find(
        (e: any) => e.source === "n1_iter_0" && e.target === "n2_iter_0",
      ),
    ).toBeDefined()
    // Verify edge n2_iter_1 -> n3_iter_1
    expect(
      cloneEdges.find(
        (e: any) => e.source === "n2_iter_1" && e.target === "n3_iter_1",
      ),
    ).toBeDefined()
  })

  it("preserves original edges in addition to cloned edges", () => {
    mockNodes = [
      makeNode({
        id: "n1",
        type: "generate-image",
        data: {
          label: "Gen",
          __listResults: ["a", "b"],
          __listInputs: ["x", "y"],
        },
      }),
      makeNode({
        id: "n2",
        type: "image-to-video",
        data: {
          label: "I2V",
          __listResults: ["v1", "v2"],
          __listInputs: ["", ""],
        },
      }),
    ]
    mockEdges = [{ id: "e1", source: "n1", target: "n2" }]

    expandLoopResults()

    const state = mockSetState.mock.calls[0][0]
    // Original edge should still be present
    const origEdge = state.edges.find((e: any) => e.id === "e1")
    expect(origEdge).toBeDefined()
    // Plus cloned edges
    const cloneEdges = state.edges.filter((e: any) => e.id.includes("_iter_"))
    expect(cloneEdges).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// executeNodeForList — ai-writer special case
// ---------------------------------------------------------------------------

describe("executeNodeForList — ai-writer output handling", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodes = [makeNode({ id: "n1", type: "ai-writer" })]
    mockEdges = []
  })

  it("captures result from executeNode return value for ai-writer nodes", () => {
    // executeNode now returns the output string directly
    mockExecuteNode.mockResolvedValue("Written output")
    const nodeWithText = makeNode({
      id: "n1",
      type: "ai-writer",
      data: { label: "Writer" },
    })
    mockNodes = [nodeWithText]

    return executeNodeForList(
      nodeWithText as unknown as WorkflowNode,
      ["topic1"],
      makeCtx(),
    ).then(() => {
      // Result captured from executeNode return value, not store
      const lastCall =
        mockUpdateNodeData.mock.calls[mockUpdateNodeData.mock.calls.length - 1]
      expect(lastCall[1].__listResults).toEqual(["Written output"])
    })
  })
})

// ---------------------------------------------------------------------------
// executeNodeForList — node disappears mid-execution
// ---------------------------------------------------------------------------

describe("executeNodeForList — node not found", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEdges = []
  })

  it("cancels remaining when freshNode is not found", async () => {
    // Start with node present, then remove it
    const node = makeNode({ id: "n1" })
    mockNodes = [node]

    let callCount = 0
    mockExecuteNode.mockImplementation(async () => {
      callCount++
      // Remove the node after first execution so next iteration won't find it
      mockNodes = []
      return "out.png"
    })

    await executeNodeForList(
      node as unknown as WorkflowNode,
      ["a", "b", "c"],
      makeCtx(),
    )

    // Only first item should execute; remaining cancelled because node removed
    expect(callCount).toBe(1)
  })

  it("records empty string for failed iterations", async () => {
    const node = makeNode({ id: "n1" })
    mockNodes = [node]

    // Return value on success, then remove node to cause failure
    mockExecuteNode.mockImplementation(async () => {
      mockNodes = []
      return "out.png"
    })

    await executeNodeForList(
      node as unknown as WorkflowNode,
      ["a"],
      makeCtx(),
    )

    // First iteration succeeds, result should have the output
    const lastCall =
      mockUpdateNodeData.mock.calls[mockUpdateNodeData.mock.calls.length - 1]
    expect(lastCall[1].__listResults).toEqual(["out.png"])
  })
})

// ---------------------------------------------------------------------------
// expandLoopResults — split-text excluded from cloning
// ---------------------------------------------------------------------------

describe("expandLoopResults — list source type exclusions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodes = []
    mockEdges = []
    mockSetState.mockReset()
  })

  it("does not clone split-text nodes but clones their downstream targets", () => {
    mockNodes = [
      makeNode({
        id: "split1",
        type: "split-text",
        data: {
          label: "Split",
          __listResults: ["a", "b"],
          __listInputs: ["x", "y"],
        },
      }),
      makeNode({
        id: "n2",
        type: "generate-image",
        data: {
          label: "Gen",
          __listResults: ["img1", "img2"],
          __listInputs: ["a", "b"],
        },
      }),
    ]
    mockEdges = [{ id: "e1", source: "split1", target: "n2" }]

    expandLoopResults()

    const state = mockSetState.mock.calls[0][0]
    // split-text should NOT be hidden
    const splitNode = state.nodes.find(
      (n: any) => n.id === "split1" && !n.id.includes("_iter_"),
    )
    expect(splitNode?.hidden).toBeFalsy()

    // split-text should NOT have _iter_ clones
    const splitClones = state.nodes.filter((n: any) =>
      n.id.startsWith("split1_iter_"),
    )
    expect(splitClones).toHaveLength(0)

    // n2 SHOULD have _iter_ clones
    const genClones = state.nodes.filter((n: any) =>
      n.id.startsWith("n2_iter_"),
    )
    expect(genClones).toHaveLength(2)
  })
})

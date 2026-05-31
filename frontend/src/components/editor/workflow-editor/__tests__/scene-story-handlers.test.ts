import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks -- must be declared before imports
// ---------------------------------------------------------------------------

const mockBatchAddNodesAndEdges = vi.fn()
const mockSelectNode = vi.fn()
const mockSetAutoOpenEditorNodeId = vi.fn()
const mockRunSingleNode = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()

let mockStoreState: Record<string, unknown>

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => mockStoreState,
  },
}))

vi.mock("@/lib/api", () => ({
  generateImage: vi.fn(),
  getJobStatusLean: vi.fn(),
}))

vi.mock("@/lib/prompt-templates", () => ({
  resolveTemplate: vi.fn().mockReturnValue("template"),
  applyTemplate: vi
    .fn()
    .mockImplementation((_t, vars) => vars.userPrompt ?? "applied"),
}))

vi.mock("../types", async () => {
  const actual = await vi.importActual("../types")
  return {
    ...actual,
    WorkflowStaleError: class WorkflowStaleError extends Error {
      constructor() {
        super("Workflow changed during execution")
      }
    },
    MAX_CONSECUTIVE_POLL_FAILURES: 3,
  }
})

import {
  handleExpandToSceneNodes,
  handleExpandStoryboard,
  handleCreateSceneNode,
} from "../scene-story-handlers"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScene(overrides: Record<string, unknown> = {}): any {
  return {
    sceneNumber: 1,
    sceneName: "Opening",
    visualDescription: "A dark forest",
    action: "Hero walks in",
    mood: "tense",
    durationHint: 5,
    imagePrompt: "dark forest scene",
    characters: ["Alice"],
    ...overrides,
  }
}

function makeScriptNode(
  scenes: any[],
  overrides: Record<string, unknown> = {},
): any {
  return {
    id: "script-1",
    type: "generate-script",
    position: { x: 0, y: 0 },
    data: {
      label: "Script",
      generatedScript: {
        title: "Test Script",
        synopsis: "A test",
        scenes,
      },
      generatedResults: [
        {
          script: {
            title: "Test Script",
            synopsis: "A test",
            scenes,
          },
          timestamp: "2024-01-01",
          jobId: "j1",
        },
      ],
      activeResultIndex: 0,
      ...overrides,
    },
  }
}

function resetStore(nodes: any[] = [], edges: any[] = []): void {
  mockStoreState = {
    nodes,
    edges,
    batchAddNodesAndEdges: mockBatchAddNodesAndEdges,
    selectNode: mockSelectNode,
    setAutoOpenEditorNodeId: mockSetAutoOpenEditorNodeId,
    runSingleNode: mockRunSingleNode,
    characterDefinitions: [],
    userPromptTemplates: [],
    flowPromptTemplates: [],
  }
}

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
})

// ---------------------------------------------------------------------------
// handleExpandToSceneNodes
// ---------------------------------------------------------------------------

describe("handleExpandToSceneNodes", () => {
  const defaultOpts = { layout: "horizontal" as const, autoRun: false }

  it("returns early if script node not found", () => {
    resetStore([{ id: "other", type: "text-prompt", position: { x: 0, y: 0 }, data: {} }])

    handleExpandToSceneNodes("nonexistent", defaultOpts)

    expect(mockBatchAddNodesAndEdges).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it("returns early if no generated script", () => {
    const node = makeScriptNode([], {
      generatedScript: undefined,
      generatedResults: [],
    })
    resetStore([node])

    handleExpandToSceneNodes("script-1", defaultOpts)

    expect(mockBatchAddNodesAndEdges).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it("creates correct number of scene nodes", () => {
    const scenes = [makeScene({ sceneNumber: 1 }), makeScene({ sceneNumber: 2 }), makeScene({ sceneNumber: 3 })]
    resetStore([makeScriptNode(scenes)])

    handleExpandToSceneNodes("script-1", defaultOpts)

    const [newNodes] = mockBatchAddNodesAndEdges.mock.calls[0]
    expect(newNodes).toHaveLength(3)
    for (const node of newNodes) {
      expect(node.type).toBe("scene")
    }
  })

  it("positions nodes horizontally when layout=horizontal", () => {
    const scenes = [makeScene({ sceneNumber: 1 }), makeScene({ sceneNumber: 2 })]
    const scriptNode = makeScriptNode(scenes)
    scriptNode.position = { x: 100, y: 200 }
    resetStore([scriptNode])

    handleExpandToSceneNodes("script-1", { layout: "horizontal", autoRun: false })

    const [newNodes] = mockBatchAddNodesAndEdges.mock.calls[0]
    const startX = 100 + 400
    expect(newNodes[0].position).toEqual({ x: startX, y: 200 })
    expect(newNodes[1].position).toEqual({ x: startX + 350, y: 200 })
  })

  it("positions nodes vertically when layout=vertical", () => {
    const scenes = [makeScene({ sceneNumber: 1 }), makeScene({ sceneNumber: 2 })]
    const scriptNode = makeScriptNode(scenes)
    scriptNode.position = { x: 100, y: 200 }
    resetStore([scriptNode])

    handleExpandToSceneNodes("script-1", { layout: "vertical", autoRun: false })

    const [newNodes] = mockBatchAddNodesAndEdges.mock.calls[0]
    const startX = 100 + 400
    expect(newNodes[0].position).toEqual({ x: startX, y: 200 })
    expect(newNodes[1].position).toEqual({ x: startX, y: 200 + 300 })
  })

  it("creates edges from script node to each scene node", () => {
    const scenes = [makeScene({ sceneNumber: 1 }), makeScene({ sceneNumber: 2 })]
    resetStore([makeScriptNode(scenes)])

    handleExpandToSceneNodes("script-1", defaultOpts)

    const [, newEdges] = mockBatchAddNodesAndEdges.mock.calls[0]
    expect(newEdges).toHaveLength(2)
    for (const edge of newEdges) {
      expect(edge.source).toBe("script-1")
      expect(edge.sourceHandle).toBe("scenes")
      expect(edge.targetHandle).toBe("in")
    }
  })

  it("copies generated images to scene nodes when available", () => {
    const images = [{ url: "http://img.png", timestamp: "2024-01-01", jobId: "j1" }]
    const scenes = [makeScene({ sceneNumber: 1, generatedImages: images, activeImageIndex: 0 })]
    resetStore([makeScriptNode(scenes)])

    handleExpandToSceneNodes("script-1", defaultOpts)

    const [newNodes] = mockBatchAddNodesAndEdges.mock.calls[0]
    expect(newNodes[0].data.executionStatus).toBe("completed")
    expect(newNodes[0].data.generatedImageUrl).toBe("http://img.png")
    expect(newNodes[0].data.generatedResults).toHaveLength(1)
    expect(newNodes[0].data.activeResultIndex).toBe(0)
  })

  it("sets autoSyncWithScript=true on created nodes", () => {
    const scenes = [makeScene({ sceneNumber: 1 })]
    resetStore([makeScriptNode(scenes)])

    handleExpandToSceneNodes("script-1", defaultOpts)

    const [newNodes] = mockBatchAddNodesAndEdges.mock.calls[0]
    expect(newNodes[0].data.autoSyncWithScript).toBe(true)
  })

  it("calls batchAddNodesAndEdges with nodes and edges", () => {
    const scenes = [makeScene({ sceneNumber: 1 })]
    resetStore([makeScriptNode(scenes)])

    handleExpandToSceneNodes("script-1", defaultOpts)

    expect(mockBatchAddNodesAndEdges).toHaveBeenCalledTimes(1)
    const [nodes, edges] = mockBatchAddNodesAndEdges.mock.calls[0]
    expect(nodes).toHaveLength(1)
    expect(edges).toHaveLength(1)
  })

  it("calls toast.success with scene count", () => {
    const scenes = [makeScene({ sceneNumber: 1 }), makeScene({ sceneNumber: 2 })]
    resetStore([makeScriptNode(scenes)])

    handleExpandToSceneNodes("script-1", defaultOpts)

    expect(mockToastSuccess).toHaveBeenCalledWith("Created 2 Scene Nodes")
  })
})

// ---------------------------------------------------------------------------
// handleExpandStoryboard
// ---------------------------------------------------------------------------

describe("handleExpandStoryboard", () => {
  const defaultOpts = {
    layout: "horizontal" as const,
    autoRun: false,
    includeCombine: false,
  }

  it("delegates to handleExpandToSceneNodes when nodeType='scene'", () => {
    const scenes = [makeScene({ sceneNumber: 1 })]
    resetStore([makeScriptNode(scenes)])

    handleExpandStoryboard("script-1", { ...defaultOpts, nodeType: "scene" })

    // handleExpandToSceneNodes creates scene-type nodes
    const [newNodes] = mockBatchAddNodesAndEdges.mock.calls[0]
    expect(newNodes).toHaveLength(1)
    expect(newNodes[0].type).toBe("scene")
    expect(mockToastSuccess).toHaveBeenCalledWith("Created 1 Scene Nodes")
  })

  it("returns early if no script", () => {
    const node = makeScriptNode([], {
      generatedScript: undefined,
      generatedResults: [],
    })
    resetStore([node])

    handleExpandStoryboard("script-1", defaultOpts)

    expect(mockBatchAddNodesAndEdges).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it("creates 5 nodes per scene (text, image, video, TTS, merge)", () => {
    const scenes = [makeScene({ sceneNumber: 1 })]
    resetStore([makeScriptNode(scenes)])

    handleExpandStoryboard("script-1", defaultOpts)

    const [newNodes] = mockBatchAddNodesAndEdges.mock.calls[0]
    expect(newNodes).toHaveLength(5)

    const types = newNodes.map((n: any) => n.type)
    expect(types).toContain("text-prompt")
    expect(types).toContain("generate-image")
    expect(types).toContain("image-to-video")
    expect(types).toContain("text-to-speech")
    expect(types).toContain("merge-video-audio")
  })

  it("creates correct edges (text->TTS, image->video, video->merge, TTS->merge)", () => {
    const scenes = [makeScene({ sceneNumber: 1 })]
    resetStore([makeScriptNode(scenes)])

    handleExpandStoryboard("script-1", defaultOpts)

    const [newNodes, newEdges] = mockBatchAddNodesAndEdges.mock.calls[0]
    const textNode = newNodes.find((n: any) => n.type === "text-prompt")
    const imgNode = newNodes.find((n: any) => n.type === "generate-image")
    const vidNode = newNodes.find((n: any) => n.type === "image-to-video")
    const ttsNode = newNodes.find((n: any) => n.type === "text-to-speech")
    const mergeNode = newNodes.find((n: any) => n.type === "merge-video-audio")

    // text -> TTS
    const txtTtsEdge = newEdges.find(
      (e: any) => e.source === textNode.id && e.target === ttsNode.id,
    )
    expect(txtTtsEdge).toBeDefined()
    expect(txtTtsEdge.sourceHandle).toBe("prompt")

    // image -> video
    const imgVidEdge = newEdges.find(
      (e: any) => e.source === imgNode.id && e.target === vidNode.id,
    )
    expect(imgVidEdge).toBeDefined()
    expect(imgVidEdge.sourceHandle).toBe("image")
    expect(imgVidEdge.targetHandle).toBe("startFrame")

    // video -> merge
    const vidMergeEdge = newEdges.find(
      (e: any) => e.source === vidNode.id && e.target === mergeNode.id,
    )
    expect(vidMergeEdge).toBeDefined()
    expect(vidMergeEdge.sourceHandle).toBe("video")

    // TTS -> merge
    const ttsMergeEdge = newEdges.find(
      (e: any) => e.source === ttsNode.id && e.target === mergeNode.id,
    )
    expect(ttsMergeEdge).toBeDefined()
    expect(ttsMergeEdge.sourceHandle).toBe("audio")
  })

  it("adds combine-videos node when includeCombine=true and >1 scene", () => {
    const scenes = [
      makeScene({ sceneNumber: 1 }),
      makeScene({ sceneNumber: 2, characters: ["Bob"] }),
    ]
    resetStore([makeScriptNode(scenes)])

    handleExpandStoryboard("script-1", { ...defaultOpts, includeCombine: true })

    const [newNodes] = mockBatchAddNodesAndEdges.mock.calls[0]
    const combineNode = newNodes.find((n: any) => n.type === "combine-videos")
    expect(combineNode).toBeDefined()
    // 5 per scene + 1 combine = 11
    expect(newNodes).toHaveLength(11)
  })

  it("does not add combine-videos when only 1 scene", () => {
    const scenes = [makeScene({ sceneNumber: 1 })]
    resetStore([makeScriptNode(scenes)])

    handleExpandStoryboard("script-1", { ...defaultOpts, includeCombine: true })

    const [newNodes] = mockBatchAddNodesAndEdges.mock.calls[0]
    const combineNode = newNodes.find((n: any) => n.type === "combine-videos")
    expect(combineNode).toBeUndefined()
    expect(newNodes).toHaveLength(5)
  })

  it("creates character reference chain edges for shared characters", () => {
    const scenes = [
      makeScene({ sceneNumber: 1, characters: ["Alice"] }),
      makeScene({ sceneNumber: 2, characters: ["Alice"] }),
      makeScene({ sceneNumber: 3, characters: ["Bob"] }),
    ]
    resetStore([makeScriptNode(scenes)])

    handleExpandStoryboard("script-1", defaultOpts)

    const [newNodes, newEdges] = mockBatchAddNodesAndEdges.mock.calls[0]
    const imageNodes = newNodes.filter((n: any) => n.type === "generate-image")

    // Alice appears in scenes 0 and 1 => chain edge from image[0] -> image[1]
    const refEdge = newEdges.find(
      (e: any) =>
        e.source === imageNodes[0].id &&
        e.target === imageNodes[1].id &&
        e.sourceHandle === "image",
    )
    expect(refEdge).toBeDefined()

    // No chain for Bob (only in one scene)
    const bobRefEdge = newEdges.find(
      (e: any) =>
        e.source === imageNodes[2].id && e.sourceHandle === "image" &&
        newEdges.some((e2: any) => e2.target === imageNodes[2].id && e2.sourceHandle === "image"),
    )
    expect(bobRefEdge).toBeUndefined()
  })

  it("copies generated images to image nodes when available", () => {
    const images = [{ url: "http://scene1.png", timestamp: "2024-01-01", jobId: "j1" }]
    const scenes = [makeScene({ sceneNumber: 1, generatedImages: images, activeImageIndex: 0 })]
    resetStore([makeScriptNode(scenes)])

    handleExpandStoryboard("script-1", defaultOpts)

    const [newNodes] = mockBatchAddNodesAndEdges.mock.calls[0]
    const imgNode = newNodes.find((n: any) => n.type === "generate-image")
    expect(imgNode.data.executionStatus).toBe("completed")
    expect(imgNode.data.generatedImageUrl).toBe("http://scene1.png")
    expect(imgNode.data.generatedResults).toHaveLength(1)
  })

  it("calls toast.success with total node count", () => {
    const scenes = [
      makeScene({ sceneNumber: 1 }),
      makeScene({ sceneNumber: 2, characters: ["Bob"] }),
    ]
    resetStore([makeScriptNode(scenes)])

    handleExpandStoryboard("script-1", defaultOpts)

    // 2 scenes * 5 nodes each = 10 nodes
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Created 10 nodes for 2 scenes",
    )
  })

  it("calls runSingleNode for scenes without images when autoRun=true", () => {
    const images = [{ url: "http://scene1.png", timestamp: "2024-01-01", jobId: "j1" }]
    const scenes = [
      makeScene({ sceneNumber: 1, generatedImages: images, activeImageIndex: 0 }),
      makeScene({ sceneNumber: 2, characters: ["Bob"] }),
    ]
    resetStore([makeScriptNode(scenes)])

    handleExpandStoryboard("script-1", { ...defaultOpts, autoRun: true })

    // Scene 1 has images -> skip. Scene 2 has no images -> run.
    // The image node for scene 2 is at index 1*5+1 = 6 in newNodes
    const [newNodes] = mockBatchAddNodesAndEdges.mock.calls[0]
    const scene2ImageNode = newNodes[1 * 5 + 1]
    expect(scene2ImageNode.type).toBe("generate-image")
    expect(mockRunSingleNode).toHaveBeenCalledTimes(1)
    expect(mockRunSingleNode).toHaveBeenCalledWith(scene2ImageNode.id)
  })
})

// ---------------------------------------------------------------------------
// handleCreateSceneNode
// ---------------------------------------------------------------------------

describe("handleCreateSceneNode", () => {
  it("returns early if script node not found", () => {
    resetStore([{ id: "other", type: "text-prompt", position: { x: 0, y: 0 }, data: {} }])

    handleCreateSceneNode("nonexistent", 0)

    expect(mockBatchAddNodesAndEdges).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it("returns early if scene index out of bounds", () => {
    const scenes = [makeScene({ sceneNumber: 1 })]
    resetStore([makeScriptNode(scenes)])

    handleCreateSceneNode("script-1", 5)

    expect(mockBatchAddNodesAndEdges).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it("creates a single scene node at correct position", () => {
    const scenes = [makeScene({ sceneNumber: 1 }), makeScene({ sceneNumber: 2 })]
    const scriptNode = makeScriptNode(scenes)
    scriptNode.position = { x: 100, y: 200 }
    resetStore([scriptNode])

    handleCreateSceneNode("script-1", 1)

    const [newNodes] = mockBatchAddNodesAndEdges.mock.calls[0]
    expect(newNodes).toHaveLength(1)
    expect(newNodes[0].type).toBe("scene")
    // posX = 100 + 400, posY = 200 + 1 * 300
    expect(newNodes[0].position).toEqual({ x: 500, y: 500 })
    expect(newNodes[0].data.label).toBe("Scene 2")
    expect(newNodes[0].data.autoSyncWithScript).toBe(true)
  })

  it("creates edge from script to scene node", () => {
    const scenes = [makeScene({ sceneNumber: 1 })]
    resetStore([makeScriptNode(scenes)])

    handleCreateSceneNode("script-1", 0)

    const [, newEdges] = mockBatchAddNodesAndEdges.mock.calls[0]
    expect(newEdges).toHaveLength(1)
    expect(newEdges[0].source).toBe("script-1")
    expect(newEdges[0].sourceHandle).toBe("scenes")
    expect(newEdges[0].targetHandle).toBe("in")
  })

  it("calls selectNode and setAutoOpenEditorNodeId", () => {
    const scenes = [makeScene({ sceneNumber: 1 })]
    resetStore([makeScriptNode(scenes)])

    handleCreateSceneNode("script-1", 0)

    const [newNodes] = mockBatchAddNodesAndEdges.mock.calls[0]
    const createdId = newNodes[0].id
    expect(mockSelectNode).toHaveBeenCalledWith(createdId)
    expect(mockSetAutoOpenEditorNodeId).toHaveBeenCalledWith(createdId)
  })
})

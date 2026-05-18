import { describe, it, expect, vi } from "vitest"

// Mock @xyflow/react before importing the store (matches sibling tests)
vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((changes, nodes) => {
    const removeIds = changes
      .filter((c: { type: string }) => c.type === "remove")
      .map((c: { id: string }) => c.id)
    if (removeIds.length > 0) {
      return nodes.filter((n: { id: string }) => !removeIds.includes(n.id))
    }
    return nodes
  }),
  applyEdgeChanges: vi.fn((changes, edges) => {
    const removeIds = changes
      .filter((c: { type: string }) => c.type === "remove")
      .map((c: { id: string }) => c.id)
    if (removeIds.length > 0) {
      return edges.filter((e: { id: string }) => !removeIds.includes(e.id))
    }
    return edges
  }),
  addEdge: vi.fn((connection, edges) => [
    ...edges,
    { ...connection, id: connection.id ?? `edge_mock` },
  ]),
}))

import { useWorkflowStore } from "../use-workflow-store"

describe("loadWorkflow — autoLoopTrim → loopTrim migration", () => {
  it("migrates autoLoopTrim=true to loopTrim={enabled:true,framesToTest:8,quality:'precise'}", () => {
    const nodes = [{
      id: "n1", type: "image-to-video", position: { x: 0, y: 0 },
      data: { label: "i2v", provider: "veo3.1", autoLoopTrim: true, fieldMappings: {} },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "n1")
    const data = loaded?.data as Record<string, unknown>
    expect(data.loopTrim).toEqual({ enabled: true, framesToTest: 8, quality: "precise" })
    expect(data.autoLoopTrim).toBeUndefined()
  })

  it("migrates autoLoopTrim=false to loopTrim={enabled:false}", () => {
    const nodes = [{
      id: "n1", type: "image-to-video", position: { x: 0, y: 0 },
      data: { label: "i2v", provider: "veo3.1", autoLoopTrim: false, fieldMappings: {} },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "n1")
    const data = loaded?.data as Record<string, unknown>
    expect(data.loopTrim).toEqual({ enabled: false })
    expect(data.autoLoopTrim).toBeUndefined()
  })

  it("leaves loopTrim untouched when autoLoopTrim is not present", () => {
    const nodes = [{
      id: "n1", type: "image-to-video", position: { x: 0, y: 0 },
      data: { label: "i2v", provider: "veo3.1", fieldMappings: {} },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "n1")
    const data = loaded?.data as Record<string, unknown>
    expect(data.loopTrim).toBeUndefined()
  })

  it("prefers existing loopTrim and drops orphan autoLoopTrim", () => {
    const nodes = [{
      id: "n1", type: "image-to-video", position: { x: 0, y: 0 },
      data: {
        label: "i2v", provider: "veo3.1", fieldMappings: {},
        autoLoopTrim: true,
        loopTrim: { enabled: true, framesToTest: 32, quality: "lossless" },
      },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "n1")
    const data = loaded?.data as Record<string, unknown>
    expect(data.loopTrim).toEqual({ enabled: true, framesToTest: 32, quality: "lossless" })
    expect(data.autoLoopTrim).toBeUndefined()
  })

  it("leaves non-i2v nodes untouched", () => {
    const nodes = [{
      id: "n1", type: "loop-video", position: { x: 0, y: 0 },
      data: { label: "loop", autoLoopTrim: true, fieldMappings: {} } as any,
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "n1")
    const data = loaded?.data as Record<string, unknown>
    expect(data.autoLoopTrim).toBe(true)  // not migrated — wrong node type
    expect(data.loopTrim).toBeUndefined()
  })
})

describe("loadWorkflow — character node migration", () => {
  it("migrates customVariations into expressions and clears it", () => {
    const nodes = [{
      id: "c1", type: "character", position: { x: 0, y: 0 },
      data: {
        label: "char", characterName: "Ada", fieldMappings: {},
        expressions: [],
        customVariations: [{ prompt: "winking playfully", url: "https://x/a.png", createdAt: "2026-01-01" }],
      },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "c1")
    const data = loaded?.data as Record<string, unknown>
    expect(data.expressions).toEqual([{ name: "winking playfully", url: "https://x/a.png" }])
    expect(data.customVariations).toEqual([])
  })

  it("de-dupes customVariations against existing expression urls when migrating", () => {
    const nodes = [{
      id: "c1", type: "character", position: { x: 0, y: 0 },
      data: {
        label: "char", characterName: "Ada", fieldMappings: {},
        expressions: [{ name: "existing", url: "https://x/a.png" }],
        customVariations: [
          { prompt: "winking playfully", url: "https://x/a.png", createdAt: "2026-01-01" },
          { prompt: "smiling warmly", url: "https://x/b.png", createdAt: "2026-01-02" },
        ],
      },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "c1")
    const data = loaded?.data as Record<string, unknown>
    expect(data.expressions).toEqual([
      { name: "existing", url: "https://x/a.png" },
      { name: "smiling warmly", url: "https://x/b.png" },
    ])
    expect(data.customVariations).toEqual([])
  })

  it("defaults motions/motionStatus/voice/personality on legacy character nodes", () => {
    const nodes = [{
      id: "c2", type: "character", position: { x: 0, y: 0 },
      data: { label: "char", characterName: "Legacy", fieldMappings: {}, expressions: [], customVariations: [] },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "c2")
    const data = loaded?.data as Record<string, unknown>
    expect(data.motions).toEqual([])
    expect(data.motionStatus).toBe("idle")
    expect(data.voice).toBeNull()
    expect(data.personality).toBeNull()
  })

  it("preserves existing motions/motionStatus/voice/personality when present", () => {
    const voice = { voiceId: "v1", voiceName: "Rachel", traits: "calm" }
    const personality = { mood: "serious", speechStyle: "terse", movementStyle: "deliberate", behavioralNotes: "" }
    const nodes = [{
      id: "c3", type: "character", position: { x: 0, y: 0 },
      data: {
        label: "char", characterName: "Full", fieldMappings: {}, expressions: [], customVariations: [],
        motions: [{ name: "wave", url: "https://x/wave.mp4" }],
        motionStatus: "completed", voice, personality,
      },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "c3")
    const data = loaded?.data as Record<string, unknown>
    expect(data.motions).toEqual([{ name: "wave", url: "https://x/wave.mp4" }])
    expect(data.motionStatus).toBe("completed")
    expect(data.voice).toEqual(voice)
    expect(data.personality).toEqual(personality)
  })

  it("leaves non-character nodes untouched", () => {
    const nodes = [{
      id: "n1", type: "image-to-video", position: { x: 0, y: 0 },
      data: { label: "i2v", provider: "veo3.1", fieldMappings: {} },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "n1")
    const data = loaded?.data as Record<string, unknown>
    expect(data.motions).toBeUndefined()
    expect(data.motionStatus).toBeUndefined()
  })
})

describe("useWorkflowStore — characterStudioNodeId state", () => {
  it("starts null and is updated by setCharacterStudioNodeId", () => {
    expect(useWorkflowStore.getState().characterStudioNodeId).toBeNull()
    useWorkflowStore.getState().setCharacterStudioNodeId("c1")
    expect(useWorkflowStore.getState().characterStudioNodeId).toBe("c1")
    useWorkflowStore.getState().setCharacterStudioNodeId(null)
    expect(useWorkflowStore.getState().characterStudioNodeId).toBeNull()
  })
})

describe("loadWorkflow — location node migration", () => {
  it("migrates customVariations into angles and clears the deprecated field", () => {
    const nodes = [{
      id: "loc1", type: "location", position: { x: 0, y: 0 },
      data: {
        label: "loc", locationName: "Forest", fieldMappings: {},
        angles: [],
        customVariations: [{ prompt: "from above", url: "https://x/a.png", createdAt: "2026-01-01" }],
      },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "loc1")
    const data = loaded?.data as Record<string, unknown>
    expect(data.angles).toEqual([{ name: "from above", url: "https://x/a.png" }])
    expect(data.customVariations).toEqual([])
  })

  it("de-dupes customVariations against existing angle urls when migrating", () => {
    const nodes = [{
      id: "loc1", type: "location", position: { x: 0, y: 0 },
      data: {
        label: "loc", locationName: "Forest", fieldMappings: {},
        angles: [{ name: "existing", url: "https://x/a.png" }],
        customVariations: [
          { prompt: "from above", url: "https://x/a.png", createdAt: "2026-01-01" },
          { prompt: "low angle", url: "https://x/b.png", createdAt: "2026-01-02" },
        ],
      },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "loc1")
    const data = loaded?.data as Record<string, unknown>
    expect(data.angles).toEqual([
      { name: "existing", url: "https://x/a.png" },
      { name: "low angle", url: "https://x/b.png" },
    ])
    expect(data.customVariations).toEqual([])
  })

  it("defaults the 9 new Phase-2 location fields on legacy nodes", () => {
    const nodes = [{
      id: "loc2", type: "location", position: { x: 0, y: 0 },
      data: { label: "loc", locationName: "Legacy", fieldMappings: {}, angles: [], customVariations: [] },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "loc2")
    const data = loaded?.data as Record<string, unknown>
    expect(data.lighting).toEqual([])
    expect(data.lightingStatus).toBe("idle")
    expect(data.seasons).toEqual([])
    expect(data.seasonsStatus).toBe("idle")
    expect(data.atmosphereMotions).toEqual([])
    expect(data.atmosphereStatus).toBe("idle")
    expect(data.referencePhotos).toEqual([])
    expect(data.canonicalDescription).toBe("")
    expect(data.styleLock).toBe(true)
  })

  it("preserves existing Phase-2 location values when present", () => {
    const lighting = [{ name: "golden hour", url: "https://x/golden.png" }]
    const seasons = [{ name: "winter", url: "https://x/winter.png" }]
    const atmosphereMotions = [{ name: "fog drift", url: "https://x/fog.mp4" }]
    const referencePhotos = [{ kind: "wide", url: "https://x/wide.png" }]
    const nodes = [{
      id: "loc3", type: "location", position: { x: 0, y: 0 },
      data: {
        label: "loc", locationName: "Full", fieldMappings: {}, angles: [], customVariations: [],
        lighting, lightingStatus: "completed",
        seasons, seasonsStatus: "running",
        atmosphereMotions, atmosphereStatus: "failed",
        referencePhotos,
        canonicalDescription: "A misty pine forest",
        styleLock: false,
      },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "loc3")
    const data = loaded?.data as Record<string, unknown>
    expect(data.lighting).toEqual(lighting)
    expect(data.lightingStatus).toBe("completed")
    expect(data.seasons).toEqual(seasons)
    expect(data.seasonsStatus).toBe("running")
    expect(data.atmosphereMotions).toEqual(atmosphereMotions)
    expect(data.atmosphereStatus).toBe("failed")
    expect(data.referencePhotos).toEqual(referencePhotos)
    expect(data.canonicalDescription).toBe("A misty pine forest")
    expect(data.styleLock).toBe(false)
  })

  it("leaves non-location nodes untouched", () => {
    const nodes = [{
      id: "n1", type: "character", position: { x: 0, y: 0 },
      data: { label: "char", characterName: "Ada", fieldMappings: {}, expressions: [], customVariations: [] },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "n1")
    const data = loaded?.data as Record<string, unknown>
    expect(data.lighting).toBeUndefined()
    expect(data.seasonsStatus).toBeUndefined()
    expect(data.atmosphereMotions).toBeUndefined()
  })
})

describe("useWorkflowStore — locationStudioNodeId state", () => {
  it("starts null and is updated by setLocationStudioNodeId", () => {
    expect(useWorkflowStore.getState().locationStudioNodeId).toBeNull()
    useWorkflowStore.getState().setLocationStudioNodeId("loc1")
    expect(useWorkflowStore.getState().locationStudioNodeId).toBe("loc1")
    useWorkflowStore.getState().setLocationStudioNodeId(null)
    expect(useWorkflowStore.getState().locationStudioNodeId).toBeNull()
  })
})

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

// ---------------------------------------------------------------------------
// Object Studio (Phase E1) — loadWorkflow migration tests.
// 5-field backfill + legacyPickerSelection breadcrumb per spec Pass 12 F-97
// + Pass 6 F-74.
// ---------------------------------------------------------------------------

describe("loadWorkflow — object node migration", () => {
  it("defaults the 5 new Phase-A object fields on legacy nodes", () => {
    const nodes = [{
      id: "obj1", type: "object", position: { x: 0, y: 0 },
      data: { label: "obj", objectName: "Legacy", fieldMappings: {}, angles: [] },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "obj1")
    const data = loaded?.data as Record<string, unknown>
    expect(data.motionClips).toEqual([])
    expect(data.motionStatus).toBe("idle")
    expect(data.referencePhotos).toEqual([])
    expect(data.canonicalDescription).toBe("")
    expect(data.styleLock).toBe(true)
  })

  it("preserves existing Phase-A object values when present", () => {
    const motionClips = [{ name: "spinning", url: "https://x/spin.mp4" }]
    const referencePhotos = [{ kind: "front", url: "https://x/front.png" }]
    const nodes = [{
      id: "obj2", type: "object", position: { x: 0, y: 0 },
      data: {
        label: "obj", objectName: "Full", fieldMappings: {}, angles: [],
        motionClips, motionStatus: "completed",
        referencePhotos,
        canonicalDescription: "Brass compass with worn leather case",
        styleLock: false,
      },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "obj2")
    const data = loaded?.data as Record<string, unknown>
    expect(data.motionClips).toEqual(motionClips)
    expect(data.motionStatus).toBe("completed")
    expect(data.referencePhotos).toEqual(referencePhotos)
    expect(data.canonicalDescription).toBe("Brass compass with worn leather case")
    expect(data.styleLock).toBe(false)
  })

  it("migrates animalId → legacyPickerSelection when category matches and clears *Id", () => {
    const nodes = [{
      id: "obj3", type: "object", position: { x: 0, y: 0 },
      data: {
        label: "obj", objectName: "Legacy animal", fieldMappings: {}, angles: [],
        category: "animal",
        animalId: "dog-golden-retriever",
      },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "obj3")
    const data = loaded?.data as Record<string, unknown>
    expect(data.legacyPickerSelection).toEqual({ kind: "animal", id: "dog-golden-retriever" })
    expect(data.animalId).toBeUndefined()
  })

  it("migrates vehicleId, furnitureId, weaponId on category match", () => {
    const nodes = [
      { id: "v", type: "object", position: { x: 0, y: 0 }, data: { label: "v", fieldMappings: {}, category: "vehicle", vehicleId: "sedan" } },
      { id: "f", type: "object", position: { x: 0, y: 0 }, data: { label: "f", fieldMappings: {}, category: "furniture", furnitureId: "sofa" } },
      { id: "w", type: "object", position: { x: 0, y: 0 }, data: { label: "w", fieldMappings: {}, category: "weapon", weaponId: "katana" } },
    ] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const all = useWorkflowStore.getState().nodes
    expect((all.find((n) => n.id === "v")?.data as Record<string, unknown>).legacyPickerSelection)
      .toEqual({ kind: "vehicle", id: "sedan" })
    expect((all.find((n) => n.id === "v")?.data as Record<string, unknown>).vehicleId).toBeUndefined()
    expect((all.find((n) => n.id === "f")?.data as Record<string, unknown>).legacyPickerSelection)
      .toEqual({ kind: "furniture", id: "sofa" })
    expect((all.find((n) => n.id === "f")?.data as Record<string, unknown>).furnitureId).toBeUndefined()
    expect((all.find((n) => n.id === "w")?.data as Record<string, unknown>).legacyPickerSelection)
      .toEqual({ kind: "weapon", id: "katana" })
    expect((all.find((n) => n.id === "w")?.data as Record<string, unknown>).weaponId).toBeUndefined()
  })

  it("does NOT migrate when animalId is set but category mismatches", () => {
    const nodes = [{
      id: "obj4", type: "object", position: { x: 0, y: 0 },
      data: {
        label: "obj", objectName: "Mismatch", fieldMappings: {}, angles: [],
        category: "weapon",  // mismatch
        animalId: "dog-golden-retriever",
      },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "obj4")
    const data = loaded?.data as Record<string, unknown>
    expect(data.legacyPickerSelection).toBeUndefined()
    // animalId NOT cleared — no migration happened
    expect(data.animalId).toBe("dog-golden-retriever")
  })

  it("re-migration prevention: legacyPickerSelection === null (user dismissed) is preserved", () => {
    const nodes = [{
      id: "obj5", type: "object", position: { x: 0, y: 0 },
      data: {
        label: "obj", objectName: "Dismissed", fieldMappings: {}, angles: [],
        category: "animal",
        animalId: "dog-golden-retriever",  // legacy field still present
        legacyPickerSelection: null,  // user dismissed the banner
      },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "obj5")
    const data = loaded?.data as Record<string, unknown>
    // Must remain null, NOT re-migrated to { kind, id }
    expect(data.legacyPickerSelection).toBeNull()
    // animalId NOT cleared because no migration happened (guard tripped)
    expect(data.animalId).toBe("dog-golden-retriever")
  })

  it("re-migration prevention: pre-set legacyPickerSelection object is preserved", () => {
    const nodes = [{
      id: "obj6", type: "object", position: { x: 0, y: 0 },
      data: {
        label: "obj", objectName: "Already-set", fieldMappings: {}, angles: [],
        category: "animal",
        animalId: "cat-tabby",
        legacyPickerSelection: { kind: "animal", id: "dog-golden-retriever" },
      },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "obj6")
    const data = loaded?.data as Record<string, unknown>
    // Existing breadcrumb preserved, NOT overwritten
    expect(data.legacyPickerSelection).toEqual({ kind: "animal", id: "dog-golden-retriever" })
    expect(data.animalId).toBe("cat-tabby")  // not cleared
  })

  it("multi-field *Id: category determines which wins (animal vs weapon both set)", () => {
    const nodes = [{
      id: "obj7", type: "object", position: { x: 0, y: 0 },
      data: {
        label: "obj", objectName: "Multi", fieldMappings: {}, angles: [],
        category: "weapon",  // category drives selection
        animalId: "dog-golden-retriever",
        weaponId: "katana",
      },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "obj7")
    const data = loaded?.data as Record<string, unknown>
    // Weapon wins because category === "weapon"
    expect(data.legacyPickerSelection).toEqual({ kind: "weapon", id: "katana" })
    // Both *Id fields cleared
    expect(data.animalId).toBeUndefined()
    expect(data.weaponId).toBeUndefined()
  })

  it("leaves non-object nodes untouched", () => {
    const nodes = [{
      id: "n1", type: "character", position: { x: 0, y: 0 },
      data: { label: "char", characterName: "Ada", fieldMappings: {}, expressions: [], customVariations: [] },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "n1")
    const data = loaded?.data as Record<string, unknown>
    expect(data.motionClips).toBeUndefined()
    expect(data.canonicalDescription).toBeUndefined()
    expect(data.legacyPickerSelection).toBeUndefined()
  })
})

describe("useWorkflowStore — objectStudioNodeId state", () => {
  it("starts null and is updated by setObjectStudioNodeId", () => {
    expect(useWorkflowStore.getState().objectStudioNodeId).toBeNull()
    useWorkflowStore.getState().setObjectStudioNodeId("obj1")
    expect(useWorkflowStore.getState().objectStudioNodeId).toBe("obj1")
    useWorkflowStore.getState().setObjectStudioNodeId(null)
    expect(useWorkflowStore.getState().objectStudioNodeId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ai-writer ("AI Agent") → llm-chat ("Generate Text") merge migration.
// One-way, non-destructive: converts saved ai-writer nodes on load, preserves
// the effective model (ai-writer defaulted to claude-sonnet-4.6 — must NOT
// silently fall to llm-chat's gemini-flash default), drops deprecated
// provider/model, and remaps the edge target handle "in" → "prompt".
// ---------------------------------------------------------------------------

describe("loadWorkflow — ai-writer → llm-chat merge migration", () => {
  it("converts ai-writer nodes to llm-chat, defaults missing model to claude-sonnet-4.6, preserves explicit model, drops provider/model, carries data, remaps edge in→prompt", () => {
    const nodes = [
      // Source node so the edge below survives loadWorkflow's
      // "drop edges referencing nonexistent nodes" filter and reaches migration.
      { id: "src", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "src", text: "hi", fieldMappings: {} } },
      {
        id: "w1", type: "ai-writer", position: { x: 0, y: 0 },
        data: {
          label: "AI Agent", templateId: "storyboard", systemPrompt: "s", userInput: "u",
          provider: "claude", model: "old", generatedItems: ["a", "b"],
          temperature: 0.7, maxTokens: 4096, fieldMappings: {},
        },
      },
      {
        id: "w2", type: "ai-writer", position: { x: 0, y: 0 },
        data: {
          label: "AI Agent 2", templateId: "custom", systemPrompt: "s2", userInput: "u2",
          llmModel: "gpt-5.4", provider: "claude", model: "old2",
          temperature: 0.7, maxTokens: 4096, fieldMappings: {},
        },
      },
    ] as any
    const edges = [
      { id: "e1", source: "src", target: "w1", targetHandle: "in" },
    ] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, edges)

    const w1 = useWorkflowStore.getState().nodes.find((n) => n.id === "w1")
    const w2 = useWorkflowStore.getState().nodes.find((n) => n.id === "w2")
    const d1 = w1?.data as Record<string, unknown>
    const d2 = w2?.data as Record<string, unknown>

    // node-type conversion
    expect(w1?.type).toBe("llm-chat")
    expect(w2?.type).toBe("llm-chat")
    // effective-model preservation
    expect(d1.llmModel).toBe("claude-sonnet-4.6") // defaulted (no llmModel in source)
    expect(d2.llmModel).toBe("gpt-5.4") // preserved
    // deprecated fields dropped
    expect(d1.provider).toBeUndefined()
    expect(d1.model).toBeUndefined()
    expect(d2.provider).toBeUndefined()
    expect(d2.model).toBeUndefined()
    // data carried over via spread
    expect(d1.templateId).toBe("storyboard")
    expect(d1.generatedItems).toEqual(["a", "b"])
    expect(d1.systemPrompt).toBe("s")
    expect(d1.userInput).toBe("u")
    // edge target handle remapped in → prompt
    const e1 = useWorkflowStore.getState().edges.find((e) => e.id === "e1")
    expect(e1?.targetHandle).toBe("prompt")
  })

  it("leaves non-ai-writer nodes and their edges untouched", () => {
    const nodes = [
      { id: "src", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "src", text: "hi", fieldMappings: {} } },
      {
        id: "k1", type: "llm-chat", position: { x: 0, y: 0 },
        data: { label: "Generate Text", systemPrompt: "", userInput: "", temperature: 0.7, maxTokens: 2048, fieldMappings: {} },
      },
    ] as any
    const edges = [
      { id: "e1", source: "src", target: "k1", targetHandle: "in" },
    ] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, edges)
    const k1 = useWorkflowStore.getState().nodes.find((n) => n.id === "k1")
    expect(k1?.type).toBe("llm-chat")
    // edge to a non-ai-writer target keeps its original "in" handle
    const e1 = useWorkflowStore.getState().edges.find((e) => e.id === "e1")
    expect(e1?.targetHandle).toBe("in")
  })
})

describe("loadWorkflow — legacy null-sourceHandle picker migration", () => {
  // Pre-typed-pip edges from picker outputs saved with `sourceHandle = null`.
  // The strict-handleId match in `useHandleConnections` would render them
  // invisible to the popover (uncleanable). Backfill the picker's default
  // source handle id so every downstream lookup sees a uniform shape.
  it("backfills sourceHandle on legacy edges from picker sources", () => {
    const nodes = [
      { id: "picker", type: "mood", position: { x: 0, y: 0 }, data: { label: "Mood" } },
      { id: "tgt", type: "generate-image", position: { x: 200, y: 0 }, data: { label: "GI", fieldMappings: {} } },
      { id: "tp", type: "text-prompt", position: { x: 0, y: 200 }, data: { label: "TP" } },
    ] as any
    const edges = [
      // Legacy: null sourceHandle on a mood node's output
      { id: "e1", source: "picker", sourceHandle: null, target: "tgt", targetHandle: "elements" },
      // Legacy: null sourceHandle on a text-prompt node's output
      { id: "e2", source: "tp", sourceHandle: null, target: "tgt", targetHandle: "prompt" },
    ] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, edges)
    const loaded = useWorkflowStore.getState().edges
    expect(loaded.find((e) => e.id === "e1")?.sourceHandle).toBe("out")
    expect(loaded.find((e) => e.id === "e2")?.sourceHandle).toBe("prompt")
  })

  it("leaves non-null sourceHandle untouched", () => {
    const nodes = [
      { id: "picker", type: "mood", position: { x: 0, y: 0 }, data: { label: "Mood" } },
      { id: "tgt", type: "generate-image", position: { x: 200, y: 0 }, data: { label: "GI", fieldMappings: {} } },
    ] as any
    const edges = [
      { id: "e1", source: "picker", sourceHandle: "out", target: "tgt", targetHandle: "elements" },
    ] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, edges)
    const e = useWorkflowStore.getState().edges.find((edge) => edge.id === "e1")
    expect(e?.sourceHandle).toBe("out")
  })

  it("leaves non-picker source edges with null sourceHandle untouched", () => {
    const nodes = [
      // An image producer (NOT a picker) — its legacy null sourceHandle is
      // handled by other migration paths if needed; we don't touch it here.
      { id: "img", type: "generate-image", position: { x: 0, y: 0 }, data: { label: "GI", fieldMappings: {} } },
      { id: "tgt", type: "image-to-video", position: { x: 200, y: 0 }, data: { label: "I2V", fieldMappings: {} } },
    ] as any
    const edges = [
      { id: "e1", source: "img", sourceHandle: null, target: "tgt", targetHandle: "image" },
    ] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, edges)
    const e = useWorkflowStore.getState().edges.find((edge) => edge.id === "e1")
    // sourceHandle stays null (or whatever generate-image-handle-migration set it to)
    expect(e?.sourceHandle).not.toBe("out")
  })
})

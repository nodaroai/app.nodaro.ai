import { describe, it, expect, vi, beforeEach } from "vitest"

// --- mocks (declared before importing the unit under test) ---
const updateNodeData = vi.fn()
let nodes: Array<{ id: string; type: string; data: Record<string, unknown> }> = []

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => ({ nodes, updateNodeData }) },
}))

const getCharacter = vi.fn()
const getObjectById = vi.fn()
const getCreatureById = vi.fn()
const getLocationById = vi.fn()
vi.mock("@/lib/api", () => ({
  getCharacter: (...a: unknown[]) => getCharacter(...a),
  getObjectById: (...a: unknown[]) => getObjectById(...a),
  getCreatureById: (...a: unknown[]) => getCreatureById(...a),
  getLocationById: (...a: unknown[]) => getLocationById(...a),
}))

// Passthrough character merger so the test doesn't pull @nodaro/shared.
vi.mock("@/lib/character-node-data", () => ({
  mergeCharacterDetailIntoNodeData: (prev: Record<string, unknown>, fresh: Record<string, unknown>) => ({
    ...prev,
    characterName: fresh.name,
    sourceImageUrl: fresh.sourceImageUrl,
  }),
}))

import { bindEntityNodeFromLibrary } from "@/lib/entity-node-data"

beforeEach(() => {
  updateNodeData.mockClear()
  getCharacter.mockReset()
  getObjectById.mockReset()
  getCreatureById.mockReset()
  getLocationById.mockReset()
  nodes = []
})

describe("bindEntityNodeFromLibrary", () => {
  it("object: carries every bucket, binds the id, and clears the stale per-node override + run-state", async () => {
    nodes = [{ id: "n1", type: "object", data: { objectDbId: "old", defaultAssetUrl: "OLD_URL", defaultAssetName: "old", generatedResults: [{ jobId: "j" }], activeResultIndex: 2, executionStatus: "completed" } }]
    getObjectById.mockResolvedValue({
      id: "new", name: "Magic Sword", description: "d", category: "weapon", style: "anime",
      sourceImageUrl: "img", angles: [{ name: "a", url: "u" }], materials: [{ name: "m", url: "u" }],
      variations: [{ name: "v", url: "u" }], motionClips: [{ name: "mc", url: "u" }],
      referencePhotos: [{ kind: "k", url: "u" }], canonicalDescription: "canon", styleLock: false,
      sheets: [], detailCloseups: [],
    })

    const ok = await bindEntityNodeFromLibrary("object", "n1", "new")
    expect(ok).toBe(true)
    const patch = updateNodeData.mock.calls[0][1] as Record<string, unknown>
    expect(patch.objectDbId).toBe("new")
    expect(patch.objectName).toBe("Magic Sword")
    expect(patch.sourceImageUrl).toBe("img")
    // every asset bucket carried from the full detail row
    expect(patch.angles).toHaveLength(1)
    expect(patch.materials).toHaveLength(1)
    expect(patch.variations).toHaveLength(1)
    expect(patch.motionClips).toHaveLength(1)
    expect(patch.referencePhotos).toHaveLength(1)
    expect(patch.styleLock).toBe(false)
    // the new asset's image must drive the thumbnail
    expect(patch.defaultAssetUrl).toBeUndefined()
    expect(patch.defaultAssetName).toBeUndefined()
    expect(patch.generatedResults).toEqual([])
    expect(patch.activeResultIndex).toBe(0)
    expect(patch.executionStatus).toBe("idle")
  })

  it("creature: carries poses + voice", async () => {
    nodes = [{ id: "c", type: "creature", data: { creatureDbId: "" } }]
    getCreatureById.mockResolvedValue({
      id: "cr", name: "Spark", description: "", species: "fox", category: "", style: "realistic",
      sourceImageUrl: "i", angles: [], poses: [{ name: "p", url: "u" }], variations: [], motionClips: [],
      referencePhotos: [], voice: { voiceId: "v", voiceName: "V", traits: "" }, canonicalDescription: "",
      styleLock: true, sheets: [], detailCloseups: [],
    })
    const ok = await bindEntityNodeFromLibrary("creature", "c", "cr")
    expect(ok).toBe(true)
    const patch = updateNodeData.mock.calls[0][1] as Record<string, unknown>
    expect(patch.creatureDbId).toBe("cr")
    expect(patch.species).toBe("fox")
    expect(patch.poses).toHaveLength(1)
    expect(patch.voice).toMatchObject({ voiceId: "v" })
  })

  it("location: carries time-of-day / weather / lighting / seasons / atmosphere", async () => {
    nodes = [{ id: "l", type: "location", data: { locationDbId: "" } }]
    getLocationById.mockResolvedValue({
      id: "lo", name: "Forest", description: "", category: "nature", style: "realistic", sourceImageUrl: "i",
      timeOfDay: [{ name: "t", url: "u" }], weather: [{ name: "w", url: "u" }], angles: [],
      lighting: [{ name: "li", url: "u" }], seasons: [{ name: "s", url: "u" }],
      atmosphereMotions: [{ name: "am", url: "u" }], referencePhotos: [], canonicalDescription: "",
      styleLock: true, sheets: [], detailCloseups: [],
    })
    const ok = await bindEntityNodeFromLibrary("location", "l", "lo")
    expect(ok).toBe(true)
    const patch = updateNodeData.mock.calls[0][1] as Record<string, unknown>
    expect(patch.locationDbId).toBe("lo")
    expect(patch.timeOfDay).toHaveLength(1)
    expect(patch.weather).toHaveLength(1)
    expect(patch.lighting).toHaveLength(1)
    expect(patch.seasons).toHaveLength(1)
    expect(patch.atmosphereMotions).toHaveLength(1)
  })

  it("character: delegates to the character merger and leaves node-run state untouched", async () => {
    nodes = [{ id: "ch", type: "character", data: { characterDbId: "old", defaultAssetUrl: "OLD", generatedResults: [{ jobId: "j" }], executionStatus: "completed" } }]
    getCharacter.mockResolvedValue({ name: "Kira", sourceImageUrl: "img" })
    const ok = await bindEntityNodeFromLibrary("character", "ch", "newc")
    expect(ok).toBe(true)
    const patch = updateNodeData.mock.calls[0][1] as Record<string, unknown>
    expect(patch.characterDbId).toBe("newc")
    expect(patch.characterName).toBe("Kira")
    expect(patch.defaultAssetUrl).toBeUndefined()
    // character has no node-level generation — its run-state must NOT be wiped
    expect(patch.generatedResults).toEqual([{ jobId: "j" }])
    expect(patch.executionStatus).toBe("completed")
  })

  it("bails (no write) when a concurrent load rebinds the node mid-fetch", async () => {
    nodes = [{ id: "n1", type: "object", data: { objectDbId: "old" } }]
    getObjectById.mockImplementation(async () => {
      // simulate a clearWorkflow()/loadWorkflow() reassigning this node id
      nodes = [{ id: "n1", type: "object", data: { objectDbId: "SOMEONE_ELSE" } }]
      return { id: "new", name: "X", angles: [], materials: [], variations: [], motionClips: [], referencePhotos: [], sheets: [], detailCloseups: [], canonicalDescription: "", styleLock: true }
    })
    const ok = await bindEntityNodeFromLibrary("object", "n1", "new")
    expect(ok).toBe(false)
    expect(updateNodeData).not.toHaveBeenCalled()
  })

  it("returns false and never writes when the fetch fails", async () => {
    nodes = [{ id: "n1", type: "object", data: { objectDbId: "old" } }]
    getObjectById.mockResolvedValue(null)
    const ok = await bindEntityNodeFromLibrary("object", "n1", "missing")
    expect(ok).toBe(false)
    expect(updateNodeData).not.toHaveBeenCalled()
  })
})

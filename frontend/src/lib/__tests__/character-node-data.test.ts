import { describe, it, expect, beforeEach, vi } from "vitest"

// `hydrateCharacterNodeFromDetail` fetches via getCharacter — stub it so the
// guard tests drive the resolve timing deterministically (the promise resolves
// on the next microtask, so synchronous state mutation between the call and the
// awaited tick lands BEFORE the .then callback runs — no flakiness).
vi.mock("@/lib/api", () => ({
  getCharacter: vi.fn(),
}))

// Importing character-node-data now transitively loads the workflow store,
// whose addNode tail-calls autoExecuteNode and reads a sticky per-device pref.
// Mirror the proven store-test mocks so the store stays hermetic.
vi.mock("@/components/editor/workflow-editor/auto-execute", () => ({
  autoExecuteNode: vi.fn(),
  cascadeAutoExecute: vi.fn(),
}))
vi.mock("@/lib/parameter-node-prefs", () => ({
  getStickyParameterDisplayMode: vi.fn(() => "picks"),
  setStickyParameterDisplayMode: vi.fn(),
}))

import {
  mergeCharacterDetailIntoNodeData,
  hydrateCharacterNodeFromDetail,
  HYDRATED_ASSET_BUCKETS,
} from "../character-node-data"
import { getCharacter } from "@/lib/api"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { CharacterNodeData } from "@/types/nodes"

type CharacterDetail = Awaited<ReturnType<typeof getCharacter>>

const base = { angles: [], bodyAngles: [], expressions: [], poses: [], lightingVariations: [], motions: [], voice: null } as unknown as CharacterNodeData

it("hydrates every asset bucket from a full character detail", () => {
  const detail = {
    id: "c1", name: "Hero", description: null, gender: null, style: null, baseOutfit: null,
    sourceImageUrl: "p.png",
    expressions: [{ name: "smile", url: "e.png" }],
    angles: [{ name: "front", url: "a.png" }],
    bodyAngles: [{ name: "front", url: "b.png" }],
    poses: [{ name: "stand", url: "po.png" }],
    lightingVariations: [{ name: "warm", url: "l.png" }],
    motions: [{ name: "wave", url: "m.mp4" }],
    sheets: [{ id: "s1", url: "sheet.png", panelUrls: [], panelSources: [] }],
    voice: { voiceId: "v", voiceName: "Rachel", traits: "calm" },
    personality: null, pendingJobs: [],
  } as unknown as Awaited<ReturnType<typeof import("@/lib/api").getCharacter>>
  const out = mergeCharacterDetailIntoNodeData(base, detail)
  expect(out.angles).toHaveLength(1)
  expect(out.bodyAngles).toHaveLength(1)
  expect(out.motions[0]?.url).toBe("m.mp4")
  expect(out.sheets?.[0]?.url).toBe("sheet.png")
  expect(out.voice?.voiceName).toBe("Rachel")
})

it("drift guard: hydrator writes every bucket listed in HYDRATED_ASSET_BUCKETS", () => {
  const detail = Object.fromEntries(
    HYDRATED_ASSET_BUCKETS.map((b) => [b, [{ name: "x", url: "x" }]]),
  ) as unknown as Awaited<ReturnType<typeof import("@/lib/api").getCharacter>>
  const out = mergeCharacterDetailIntoNodeData(base, { ...detail, id: "c", name: "n", pendingJobs: [] } as never)
  for (const b of HYDRATED_ASSET_BUCKETS) {
    expect((out as Record<string, unknown>)[b], `bucket ${b} not hydrated`).toBeTruthy()
  }
})

describe("hydrateCharacterNodeFromDetail (stale-clobber guard)", () => {
  // Snapshot once and `setState(initial, true)` (REPLACE, not merge) per test so
  // addNode's internal `newNodeIds` Set can't accumulate across cases.
  const initialState = useWorkflowStore.getState()

  beforeEach(() => {
    useWorkflowStore.setState(initialState, true)
    vi.mocked(getCharacter).mockReset()
  })

  /** A full detail whose presence in the node proves the merge actually ran. */
  function detailFor(id: string): CharacterDetail {
    return {
      id, name: "Hero", description: null, gender: null, style: null, baseOutfit: null,
      sourceImageUrl: "p.png",
      expressions: [], poses: [], lightingVariations: [], bodyAngles: [], motions: [],
      angles: [{ name: "front", url: "hydrated.png" }],
      sheets: [], voice: null, personality: null, pendingJobs: [],
    } as unknown as CharacterDetail
  }

  it("Case 1 (match): hydrates angles when the node still binds the same character id", async () => {
    const nodeId = useWorkflowStore.getState().addNode("character", { x: 0, y: 0 })
    expect(nodeId).toBeDefined()
    // Optimistic light fields, with characterDbId === the id we'll fetch.
    useWorkflowStore.getState().updateNodeData(nodeId!, { characterDbId: "A", angles: [] })

    vi.mocked(getCharacter).mockResolvedValue(detailFor("A"))
    hydrateCharacterNodeFromDetail(nodeId!, "A")
    await Promise.resolve() // flush the getCharacter().then microtask

    const node = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
    const data = node?.data as CharacterNodeData
    expect(getCharacter).toHaveBeenCalledWith("A")
    expect(data.angles).toHaveLength(1)
    expect(data.angles[0]?.url).toBe("hydrated.png")
  })

  it("Case 2 (stale/mismatch): does NOT clobber a node whose id was re-issued to a different character", async () => {
    const nodeId = useWorkflowStore.getState().addNode("character", { x: 0, y: 0 })
    expect(nodeId).toBeDefined()
    useWorkflowStore.getState().updateNodeData(nodeId!, { characterDbId: "A", angles: [] })

    vi.mocked(getCharacter).mockResolvedValue(detailFor("A"))
    // Fire the hydrate for character A…
    hydrateCharacterNodeFromDetail(nodeId!, "A")
    // …then SYNCHRONOUSLY (before the .then microtask) simulate a
    // clearWorkflow()/loadWorkflow() re-issuing this node id to character B.
    useWorkflowStore.getState().updateNodeData(nodeId!, { characterDbId: "B" })
    await Promise.resolve() // flush the getCharacter().then microtask

    const node = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
    const data = node?.data as CharacterNodeData
    // Guard held: still character B, and A's angles were NOT merged in.
    expect(data.characterDbId).toBe("B")
    expect(data.angles).toHaveLength(0)
  })

  it("Case 3 (node gone): no throw when the node was removed before the fetch resolved", async () => {
    const nodeId = useWorkflowStore.getState().addNode("character", { x: 0, y: 0 })
    expect(nodeId).toBeDefined()
    useWorkflowStore.getState().updateNodeData(nodeId!, { characterDbId: "A", angles: [] })

    vi.mocked(getCharacter).mockResolvedValue(detailFor("A"))
    hydrateCharacterNodeFromDetail(nodeId!, "A")
    // Wipe the canvas before resolution — find() returns undefined, guard skips.
    useWorkflowStore.setState({ nodes: [] })
    await expect(Promise.resolve().then(() => {})).resolves.toBeUndefined()

    expect(useWorkflowStore.getState().nodes).toHaveLength(0)
  })
})

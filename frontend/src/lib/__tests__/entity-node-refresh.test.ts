/**
 * The canvas half of "a node bound to an entity that has no picture on it".
 *
 * The Copilot writes `{ characterDbId }` and nothing else. The run engine
 * hydrates that server-side, so the RUN is right — but until this ran, the
 * canvas showed an empty card and the user had to reload the page to see who
 * they had just been given.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api", () => ({
  getCharacter: vi.fn(),
  getObjectById: vi.fn(),
  getCreatureById: vi.fn(),
  getLocationById: vi.fn(),
}))
vi.mock("@/components/editor/workflow-editor/auto-execute", () => ({
  autoExecuteNode: vi.fn(),
  cascadeAutoExecute: vi.fn(),
}))
vi.mock("@/lib/parameter-node-prefs", () => ({
  getStickyParameterDisplayMode: vi.fn(() => "picks"),
  setStickyParameterDisplayMode: vi.fn(),
}))

import { ENTITY_KINDS, ENTITY_DB_ID_FIELD, refreshEntityNodes } from "../entity-node-data"
import { ENTITY_BUCKET_FIELDS } from "@nodaro/shared"
import { getCharacter, getObjectById, getCreatureById, getLocationById } from "@/lib/api"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

const FETCHERS = {
  character: getCharacter,
  object: getObjectById,
  creature: getCreatureById,
  location: getLocationById,
} as const

/** Enough of a detail row that a merge is observable. */
function detailFor(id: string) {
  return {
    id,
    name: "Amma",
    description: "a botanist",
    sourceImageUrl: "https://r2.example/amma.png",
    expressions: [], poses: [], lightingVariations: [], bodyAngles: [], motions: [],
    angles: [{ name: "front", url: "https://r2.example/front.png" }],
    sheets: [], voice: null, personality: null, pendingJobs: [],
  } as never
}

/** Place one entity node of `kind`, bound to `dbId`, with `extra` node data. */
function placeNode(kind: (typeof ENTITY_KINDS)[number], dbId: string, extra: Record<string, unknown> = {}) {
  const nodeId = useWorkflowStore.getState().addNode(kind, { x: 0, y: 0 })!
  useWorkflowStore.getState().updateNodeData(nodeId, { [ENTITY_DB_ID_FIELD[kind]]: dbId, ...extra })
  return nodeId
}

/** fetchDetail is an async wrapper around the getter, so the merge lands a few
 *  microtasks after the call — flush the queue rather than counting ticks. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function nodes() {
  return useWorkflowStore.getState().nodes
}

describe("refreshEntityNodes", () => {
  const initialState = useWorkflowStore.getState()

  beforeEach(() => {
    useWorkflowStore.setState(initialState, true)
    for (const fetcher of Object.values(FETCHERS)) vi.mocked(fetcher).mockReset()
  })

  it.each(ENTITY_KINDS)("refreshes a %s node — every kind, or the next one is silently missed", async (kind) => {
    vi.mocked(FETCHERS[kind]).mockResolvedValue(detailFor("e1") as never)
    placeNode(kind, "e1")

    refreshEntityNodes(nodes())
    await flush()

    expect(FETCHERS[kind]).toHaveBeenCalledWith("e1")
    const data = nodes()[0]!.data as Record<string, unknown>
    expect(data.sourceImageUrl).toBe("https://r2.example/amma.png")
  })

  it.each(ENTITY_KINDS)("carries every %s bucket the shared list declares", async (kind) => {
    // The per-kind merges hand-list their buckets. The shared vocabulary is
    // what the SERVER hydrates from, so a bucket added there and forgotten
    // here means the canvas quietly shows less than the run uses — the exact
    // drift the shared list was introduced to end.
    const buckets = ENTITY_BUCKET_FIELDS[kind].map(([, nodeField]) => nodeField)
    const detail = {
      id: "e1",
      name: "Amma",
      description: "d",
      sourceImageUrl: "https://r2.example/amma.png",
      voice: null,
      personality: null,
      pendingJobs: [],
      ...Object.fromEntries(buckets.map((b) => [b, [{ name: "x", url: "https://r2.example/x.png" }]])),
    }
    vi.mocked(FETCHERS[kind]).mockResolvedValue(detail as never)
    placeNode(kind, "e1")

    refreshEntityNodes(nodes())
    await flush()

    const data = nodes()[0]!.data as Record<string, unknown>
    for (const bucket of buckets) {
      expect(Array.isArray(data[bucket]) && (data[bucket] as unknown[]).length > 0, `${kind}.${bucket} not carried`).toBe(true)
    }
  })

  it("fills a node an agent wrote with an id and no media", async () => {
    vi.mocked(getCharacter).mockResolvedValue(detailFor("char-1") as never)
    placeNode("character", "char-1")

    refreshEntityNodes(nodes(), { onlyMissingMedia: true })
    await flush()

    expect(getCharacter).toHaveBeenCalledWith("char-1")
    expect((nodes()[0]!.data as Record<string, unknown>).characterName).toBe("Amma")
  })

  it("leaves a node that already has its picture alone", async () => {
    // This runs on EVERY remote write. Refreshing a populated node would be one
    // request per entity node per keystroke in another tab.
    vi.mocked(getCharacter).mockResolvedValue(detailFor("char-1") as never)
    placeNode("character", "char-1", { sourceImageUrl: "https://r2.example/already.png" })

    refreshEntityNodes(nodes(), { onlyMissingMedia: true })
    await flush()

    expect(getCharacter).not.toHaveBeenCalled()
  })

  it("counts a per-node default asset as media", async () => {
    vi.mocked(getCharacter).mockResolvedValue(detailFor("char-1") as never)
    placeNode("character", "char-1", { defaultAssetUrl: "https://r2.example/pose.png" })

    refreshEntityNodes(nodes(), { onlyMissingMedia: true })
    await flush()

    expect(getCharacter).not.toHaveBeenCalled()
  })

  it("fetches an entity once however many nodes are bound to it", async () => {
    // This runs over the whole canvas on every load. The same character in
    // four shots was four identical requests — these call the API directly,
    // so nothing upstream dedupes them.
    vi.mocked(getCharacter).mockResolvedValue(detailFor("char-1") as never)
    placeNode("character", "char-1")
    placeNode("character", "char-1")
    placeNode("character", "char-2")

    refreshEntityNodes(nodes())
    await flush()

    expect(vi.mocked(getCharacter).mock.calls.length).toBe(2)
    for (const node of nodes()) {
      expect((node.data as Record<string, unknown>).sourceImageUrl).toBe("https://r2.example/amma.png")
    }
  })

  it("skips an entity node bound to nothing", async () => {
    placeNode("character", "")

    refreshEntityNodes(nodes())
    await flush()

    expect(getCharacter).not.toHaveBeenCalled()
  })

  it("ignores nodes that are not entities", async () => {
    useWorkflowStore.getState().addNode("text-prompt", { x: 0, y: 0 })

    refreshEntityNodes(nodes())
    await flush()

    for (const fetcher of Object.values(FETCHERS)) expect(fetcher).not.toHaveBeenCalled()
  })

  it("does not write when the live detail already matches the node", async () => {
    // A no-op refresh must not mark the workflow dirty — otherwise every remote
    // reconcile would trip the autosave and the "changed elsewhere" latch.
    vi.mocked(getCharacter).mockResolvedValue(detailFor("char-1") as never)
    const nodeId = placeNode("character", "char-1")
    refreshEntityNodes(nodes())
    await flush()

    const settled = JSON.stringify(nodes().find((n) => n.id === nodeId)!.data)
    const spy = vi.spyOn(useWorkflowStore.getState(), "updateNodeData")
    refreshEntityNodes(nodes())
    await flush()

    expect(spy).not.toHaveBeenCalled()
    expect(JSON.stringify(nodes().find((n) => n.id === nodeId)!.data)).toBe(settled)
    spy.mockRestore()
  })

  it("does not mark the workflow dirty — it re-derived, it did not edit", async () => {
    // Two things break if it does. An autosave fires for data the server can
    // re-derive at any time; and the copilot's `ensureCanvasVersion` sees a
    // dirty canvas and REFUSES to adopt its own next edit, so a multi-edit
    // turn leaves the user looking at a stale graph.
    vi.mocked(getCharacter).mockResolvedValue(detailFor("char-1") as never)
    placeNode("character", "char-1")
    useWorkflowStore.setState({ isDirty: false })

    refreshEntityNodes(nodes(), { onlyMissingMedia: true })
    await flush()

    expect((nodes()[0]!.data as Record<string, unknown>).sourceImageUrl).toBe("https://r2.example/amma.png")
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it("does not clobber a node rebound while the fetch was in flight", async () => {
    vi.mocked(getCharacter).mockResolvedValue(detailFor("char-1") as never)
    const nodeId = placeNode("character", "char-1")

    refreshEntityNodes(nodes())
    useWorkflowStore.getState().updateNodeData(nodeId, { characterDbId: "char-2" })
    await flush()

    const data = nodes().find((n) => n.id === nodeId)!.data as Record<string, unknown>
    expect(data.characterDbId).toBe("char-2")
    expect(data.sourceImageUrl ?? "").toBe("")
  })

  it("survives a failed fetch", async () => {
    vi.mocked(getCharacter).mockRejectedValue(new Error("offline"))
    placeNode("character", "char-1")

    refreshEntityNodes(nodes())
    await flush()

    expect(nodes()).toHaveLength(1)
  })
})

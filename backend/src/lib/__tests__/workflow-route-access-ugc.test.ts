/**
 * The editable-copy source (`loadStudioEditableCopySource`): a workflow its owner shared with
 * editable copies allowed can be read for copying by anyone signed in. A copy made by anyone but
 * the author goes as a published template does — a UGC video's runs, everything made from it and
 * the author's photo never go with it (`stripUgcPublishState`). The author's own copy is the graph
 * as it is. The URLs are placeholders.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  access: "none" as string,
  /** The author's other workflows a sub-workflow node refers to, by id. */
  children: new Map<string, { nodes: unknown[]; edges: unknown[] }>(),
}))

vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => {
      let id: unknown
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = (column: string, value: unknown) => {
        if (column === "id") id = value
        return chain
      }
      chain.maybeSingle = async () => ({ data: h.row, error: null })
      chain.single = async () => {
        const child = typeof id === "string" ? h.children.get(id) : undefined
        return child ? { data: child, error: null } : { data: null, error: { code: "PGRST116" } }
      }
      return chain
    },
  },
}))
vi.mock("../workflow-access.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../workflow-access.js")>()),
  workflowAccessFromRow: vi.fn(async () => h.access),
}))

import { loadStudioEditableCopySource, loadWorkflowFor } from "../workflow-route-access.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const COPIER = "00000000-0000-4000-8000-0000000000ff"
const PHOTO = "https://cdn.example/author-face.png"
const TAKE = "https://cdn.example/take.mp4"

function sharedRow() {
  return {
    id: "wf-1",
    user_id: OWNER,
    workspace_id: null,
    visibility: "private",
    settings: { studio: { shared: true, allowEditableCopy: true } },
    nodes: [
      { id: "photo", type: "upload-image", data: { label: "Your photo", url: PHOTO, r2Url: PHOTO } },
      { id: "creator", type: "ugc-creator", data: { source: "photo", gender: "man", photoUrl: PHOTO, keepResult: true, result: { v: 1, identityImages: [PHOTO] } } },
      { id: "clips", type: "ugc-clips", data: {} },
      { id: "clip", type: "ugc-clip", data: { generatedVideoUrl: TAKE, generatedResults: [{ url: TAKE, jobId: "job-take", timestamp: "t" }] } },
    ],
    edges: [
      { id: "e1", source: "photo", target: "creator", targetHandle: "photo" },
      { id: "e2", source: "creator", target: "clips", targetHandle: "creator" },
      { id: "e3", source: "clips", target: "clip", targetHandle: "clip" },
    ],
  }
}

const reply = () => {
  const r = { status: vi.fn(() => r), send: vi.fn(() => r) }
  return r
}
const load = (loader: typeof loadWorkflowFor, userId: string) =>
  loader({} as never, reply() as never, userId, "wf-1", "view", "id, user_id, workspace_id, visibility, settings, nodes, edges", "Failed", { resolveResultIds: false })

beforeEach(() => {
  h.row = sharedRow()
  h.children.clear()
})

describe("the editable-copy source", () => {
  it("anyone but the author reads it as published: no author's photo, kept creator or take", async () => {
    h.access = "none"
    const loaded = await load(loadStudioEditableCopySource, COPIER)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(JSON.stringify(loaded.row.nodes)).not.toContain(PHOTO)
    expect(JSON.stringify(loaded.row.nodes)).not.toContain(TAKE)
    const creator = (loaded.row.nodes as Array<{ id: string; data: Record<string, unknown> }>).find((n) => n.id === "creator")!
    expect(creator.data).toEqual({ source: "photo", gender: "man", keepResult: false })
  })

  it("the settings go too: a character definition whose picture is the author's photo goes without it, another as it is", async () => {
    const BRAND = "https://cdn.example/brand-mascot.png"
    const row = sharedRow()
    h.row = {
      ...row,
      settings: {
        ...row.settings,
        characterDefinitions: [
          { id: "def-me", name: "Me", type: "reference", referenceImageUrl: PHOTO },
          { id: "def-brand", name: "Mascot", type: "reference", referenceImageUrl: BRAND },
        ],
      },
    }
    h.access = "none"
    const loaded = await load(loadStudioEditableCopySource, COPIER)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect((loaded.row.settings as { characterDefinitions?: unknown }).characterDefinitions).toEqual([
      { id: "def-me", name: "Me", type: "reference" },
      { id: "def-brand", name: "Mascot", type: "reference", referenceImageUrl: BRAND },
    ])
  })

  it("the author's photo through a step into the creator's photo: no node on that path goes with the copy", async () => {
    const UPSCALED = "https://cdn.example/author-upscaled.png"
    const row = sharedRow()
    h.row = {
      ...row,
      nodes: [...row.nodes, { id: "step", type: "upscale-image", data: { upscaleFactor: 2, generatedImageUrl: UPSCALED, generatedResults: [{ url: UPSCALED, jobId: "job-up", timestamp: "t" }] } }],
      edges: [
        ...row.edges.filter((e) => e.id !== "e1"),
        { id: "p1", source: "photo", target: "step", targetHandle: "image" },
        { id: "p2", source: "step", target: "creator", targetHandle: "photo" },
      ],
    }
    h.access = "none"
    const loaded = await load(loadStudioEditableCopySource, COPIER)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    for (const own of [PHOTO, UPSCALED]) expect(JSON.stringify(loaded.row.nodes), own).not.toContain(own)
    const step = (loaded.row.nodes as Array<{ id: string; data: Record<string, unknown> }>).find((n) => n.id === "step")!
    expect(step.data).toEqual({ upscaleFactor: 2 })
  })

  it("a sub-workflow whose graph holds a UGC video goes as one of the video's nodes: without its outputs, nor what is made from them", async () => {
    const NESTED_RENDER = "https://cdn.example/nested-ugc.mp4"
    const AFTER = "https://cdn.example/after-nested.mp4"
    h.row = {
      ...sharedRow(),
      nodes: [
        { id: "nested", type: "sub-workflow", data: { workflowId: "wf-child", outputResults: { out: NESTED_RENDER }, generatedResults: [{ url: NESTED_RENDER, jobId: "sub-1", timestamp: "t" }] } },
        { id: "after", type: "combine-videos", data: { transition: "cut", generatedVideoUrl: AFTER } },
      ],
      edges: [{ id: "n1", source: "nested", target: "after", targetHandle: "in" }],
    }
    h.children.set("wf-child", { nodes: [{ id: "c", type: "ugc-creator", data: { source: "sampled" } }], edges: [] })
    h.access = "none"
    const loaded = await load(loadStudioEditableCopySource, COPIER)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    for (const own of [NESTED_RENDER, AFTER]) expect(JSON.stringify(loaded.row.nodes), own).not.toContain(own)
    // The author's own copy keeps them.
    h.access = "own"
    const own = await load(loadStudioEditableCopySource, OWNER)
    expect(own.ok && JSON.stringify(own.row.nodes)).toContain(NESTED_RENDER)
  })

  it("the author's own copy is the graph as it is", async () => {
    h.access = "own"
    const loaded = await load(loadStudioEditableCopySource, OWNER)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(JSON.stringify(loaded.row.nodes)).toContain(PHOTO)
    expect(JSON.stringify(loaded.row.nodes)).toContain(TAKE)
  })

  it("an ordinary read is not the copy source: it is unchanged", async () => {
    h.access = "view"
    const loaded = await load(loadWorkflowFor, COPIER)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(JSON.stringify(loaded.row.nodes)).toContain(TAKE)
  })
})

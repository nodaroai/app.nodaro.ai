/**
 * A run's UGC Creators set to "My photo", read across every graph it executes
 * (`ugcRunMissesPhoto`): a creator has a photo only through a value of the runner's own — its photo
 * field as an input of the run, or a value given to a node of the run's graph in that creator's
 * photo influence set, read across sub-workflow ports both ways. Nothing a graph holds counts: an
 * upload inside a sub-workflow, or a node that makes the image in the run, is never the runner's.
 * The URLs and ids are placeholders.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

const db = vi.hoisted(() => ({ workflows: new Map<string, { nodes: unknown[]; edges: unknown[] }>() }))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => {
      const filters: Record<string, unknown> = {}
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = (column: string, value: unknown) => {
        filters[column] = value
        return chain
      }
      chain.single = async () => {
        const row = filters.user_id === OWNER ? db.workflows.get(filters.id as string) : undefined
        return row ? { data: row, error: null } : { data: null, error: { code: "PGRST116" } }
      }
      return chain
    },
  },
}))

import { ugcAppRunMissesPhoto, ugcRunMissesPhoto } from "../ugc-app-run.js"

const OWNER = "owner-1"
const RUNNERS = "https://cdn.example/runner.png"
const AUTHOR = "https://cdn.example/author.png"

type N = { id: string; type: string; data: Record<string, unknown> }
const n = (id: string, type: string, data: Record<string, unknown> = {}): N => ({ id, type, data: { label: id, ...data } })
const e = (source: string, target: string, targetHandle: string, sourceHandle: string | null = null) => ({ id: `${source}-${target}-${targetHandle}`, source, target, sourceHandle, targetHandle })
const creator = (id = "creator") => n(id, "ugc-creator", { source: "photo", gender: "woman" })
const out = () => n("out", "sub-workflow-output", { ports: [{ id: "p1", mediaType: "image" }] })
const input = () => n("in", "sub-workflow-input", { ports: [{ id: "i1", mediaType: "image" }] })

/** The run's graph: a My photo creator fed from a sub-workflow node's output; on request an upload of the run's wired into the sub-workflow. */
function parent(opts: { upload?: boolean; sub?: Record<string, unknown> } = {}) {
  const nodes = [n("sub", "sub-workflow", { workflowId: "wf-child", ...opts.sub }), creator(), ...(opts.upload ? [n("up", "upload-image")] : [])]
  const edges = [e("sub", "creator", "photo", "out_p1"), ...(opts.upload ? [e("up", "sub", "in_i1", "image")] : [])]
  return { nodes, edges }
}
const miss = (graph: { nodes: N[]; edges: unknown[] }, overrides?: Record<string, Record<string, unknown>>, nodeIds?: string[]) =>
  ugcRunMissesPhoto(graph.nodes, graph.edges as never, overrides, nodeIds, OWNER)

// The check loads the composed graph's reader on first use; load it once here so no case pays for it.
beforeAll(async () => {
  await import("../ugc-composed-graph.js")
}, 60_000)
beforeEach(() => db.workflows.clear())

describe("a creator whose photo comes from a sub-workflow", () => {
  it("whose output comes from an upload inside it — the author's, emptied as published: the photo is missing", async () => {
    db.workflows.set("wf-child", { nodes: [n("up", "upload-image", { url: AUTHOR }), n("step", "upscale-image"), out()], edges: [e("up", "step", "image"), e("step", "out", "p1")] })
    expect(await miss(parent())).toBe(true)
    // The runner's photo on the creator's card is the photo.
    expect(await miss(parent(), { creator: { photoUrl: RUNNERS } })).toBe(false)
  })

  it("whose output a node inside it makes in the run: no photo of the runner's", async () => {
    db.workflows.set("wf-child", { nodes: [n("gen", "generate-image"), out()], edges: [e("gen", "out", "p1")] })
    expect(await miss(parent())).toBe(true)
  })

  it("whose output comes back through its input: the run's own upload, filled by the runner, is the photo", async () => {
    db.workflows.set("wf-child", { nodes: [input(), n("step", "upscale-image"), out()], edges: [e("in", "step", "image", "i1"), e("step", "out", "p1")] })
    expect(await miss(parent({ upload: true }))).toBe(true)
    expect(await miss(parent({ upload: true }), { up: { url: RUNNERS } })).toBe(false)
    // Nothing wired into the sub-workflow: nothing comes back through its input.
    expect(await miss(parent())).toBe(true)
  })

  it("with no output node, its graph's terminal nodes are what it hands out: none is the runner's", async () => {
    db.workflows.set("wf-child", { nodes: [n("up", "upload-image", { url: AUTHOR }), n("step", "upscale-image")], edges: [e("up", "step", "image")] })
    expect(await miss(parent())).toBe(true)
    db.workflows.set("wf-child", { nodes: [n("gen", "generate-image")], edges: [] })
    expect(await miss(parent())).toBe(true)
  })

  it("at any depth: a sub-workflow inside it is read the same way, and a value the runner gives the top graph reaches down through every input", async () => {
    db.workflows.set("wf-child", { nodes: [input(), n("inner", "sub-workflow", { workflowId: "wf-inner" }), out()], edges: [e("in", "inner", "in_i1", "i1"), e("inner", "out", "p1", "out_p1")] })
    db.workflows.set("wf-inner", { nodes: [input(), n("own", "upload-image", { url: AUTHOR }), n("mix", "image-collage"), out()], edges: [e("in", "mix", "in", "i1"), e("own", "mix", "in"), e("mix", "out", "p1")] })
    expect(await miss(parent({ upload: true }))).toBe(true)
    expect(await miss(parent({ upload: true }), { up: { url: RUNNERS } })).toBe(false)
  })

  it("a graph the run cannot load is read from what feeds the sub-workflow node", async () => {
    expect(await miss(parent({ upload: true }))).toBe(true)
    expect(await miss(parent({ upload: true }), { up: { url: RUNNERS } })).toBe(false)
  })

  it("the reference the editor writes is read like the one a run reads", async () => {
    db.workflows.set("wf-child", { nodes: [n("up", "upload-image", { url: AUTHOR }), out()], edges: [e("up", "out", "p1")] })
    const editors = parent({ upload: true, sub: { workflowId: undefined, referencedWorkflowId: "wf-child" } })
    // The upload inside is the author's; the run's own upload feeds only the sub-workflow's input, which reaches no output.
    expect(await miss(editors, { up: { url: RUNNERS } })).toBe(true)
    expect(await miss(editors, { creator: { photoUrl: RUNNERS } })).toBe(false)
  })
})

describe("a creator inside a sub-workflow", () => {
  it("fed through the sub-workflow's input: a photo once the runner fills what feeds the sub-workflow node above", async () => {
    db.workflows.set("wf-child", { nodes: [input(), creator("inner-creator")], edges: [e("in", "inner-creator", "photo", "i1")] })
    const graph = { nodes: [n("sub", "sub-workflow", { workflowId: "wf-child" }), n("up", "upload-image")], edges: [e("up", "sub", "in_i1", "image")] }
    expect(await miss(graph)).toBe(true)
    expect(await miss(graph, { up: { url: RUNNERS } })).toBe(false)
    // The upload's own image is the author's.
    const stored = { ...graph, nodes: [graph.nodes[0]!, n("up", "upload-image", { url: AUTHOR })] }
    expect(await miss(stored)).toBe(true)
  })

  it("fed only an upload inside it is refused: the author's, emptied as published", async () => {
    db.workflows.set("wf-child", { nodes: [n("up", "upload-image", { url: AUTHOR }), creator("inner-creator")], edges: [e("up", "inner-creator", "photo")] })
    expect(await miss({ nodes: [n("sub", "sub-workflow", { workflowId: "wf-child" })], edges: [] })).toBe(true)
  })

  it("one the run does not execute is not asked: a sub-workflow outside the run's part, or a frozen one", async () => {
    db.workflows.set("wf-child", { nodes: [n("up", "upload-image", { url: AUTHOR }), creator("inner-creator")], edges: [e("up", "inner-creator", "photo")] })
    expect(await miss({ nodes: [n("sub", "sub-workflow", { workflowId: "wf-child" }), n("other", "generate-image")], edges: [] }, undefined, ["other"])).toBe(false)
    expect(await miss({ nodes: [n("sub", "sub-workflow", { workflowId: "wf-child", skipped: true })], edges: [] })).toBe(false)
  })
})

describe("the run's own graph alone (ugcAppRunMissesPhoto)", () => {
  it("a sub-workflow on the path is read from what feeds it: nothing here", () => {
    const { nodes, edges } = parent()
    expect(ugcAppRunMissesPhoto(nodes, edges, undefined)).toBe(true)
  })
})

/**
 * A selected Apply EDL take in the BROWSER engine — the editor half of the
 * engine-split check (A1-0).
 *
 * The bug: the config-panel results gallery treated Apply EDL as an image, so
 * picking an older take wrote `generatedImageUrl`. The canvas then used the
 * picked take (it reads the selected result first) while a workflow run read the
 * newest one (the server reads `generatedVideoUrl` first), and the pick was
 * saved, so the two kept disagreeing.
 *
 * This file clicks the REAL gallery, applies the update it emits the way the
 * config panel does (the store merges it into the node), lets the pick's read of
 * the take's job settle, and requires:
 *   1. the resulting node data to equal the fixture's `after` — the same data
 *      the server test (backend/src/services/workflow-engine/__tests__/
 *      apply-edl-picked-take.test.ts) runs the orchestrator's saved-data path
 *      on, so the two files together cover both engines;
 *   2. the browser engine to hand the picked take downstream, as the medium the
 *      node's `output` names, with the Transcript that take was cut with — or
 *      with none when the take's own cannot be known, never another take's
 *      (extractNodeOutput, and the next node's inputs).
 * It also runs the browser engine on the fixture's `runs` data: what a
 * workflow run leaves on the node with no pick (the run-result lane that
 * writes it is pinned in sync-node-states-named-outputs.test.ts).
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"

const { store, getJobStatus, getJobStatusLean } = vi.hoisted(() => {
  interface StoreNode { readonly id: string; readonly type: string; readonly data: Record<string, unknown> }
  const store = {
    characterDefinitions: [] as unknown[],
    nodes: [] as StoreNode[],
    edges: [] as unknown[],
    setWorkflowThumbnail: () => {},
    updateNodeData(id: string, patch: Record<string, unknown>) {
      store.nodes = store.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
    },
  }
  return { store, getJobStatus: vi.fn(), getJobStatusLean: vi.fn() }
})

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (select: (s: typeof store) => unknown) => select(store),
    { getState: () => store },
  ),
}))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getJobStatus,
  getJobStatusLean,
}))
vi.mock("@/components/editor/save-to-library-button", () => ({
  SaveToLibraryButton: () => null,
}))
vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (p: { src?: string; alt?: string }) => <img src={p.src} alt={p.alt} />,
}))
vi.mock("../job-config-display", () => ({ JobConfigDisplay: () => null }))

import fixture from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/apply-edl-picked-take.json"
import { ResultsGallery } from "../results-gallery"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import { resolveNodeInputs } from "@/components/editor/workflow-editor/node-input-resolver"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

interface Consumer {
  readonly id: string
  readonly type: string
  readonly targetHandle: string
  readonly receives: string
  /** The consumer's json input wired to Apply EDL's Transcript output, if any. */
  readonly transcriptHandle?: string
}

interface SavedNode { readonly id: string; readonly type: string; readonly data: Record<string, unknown> }

interface PickCase {
  readonly consumer: Consumer
  readonly pickIndex: number
  /** The job behind the picked take, as GET /v1/jobs/:id/status returns it.
   *  Any other job id answers "not found". */
  readonly job?: { readonly id: string; readonly output_data: Record<string, unknown> }
  readonly before: SavedNode
  readonly after: SavedNode
}

interface RunCase {
  readonly consumer: Consumer
  readonly before: SavedNode
  readonly after: SavedNode
}

const CASES = fixture.cases as unknown as Record<"video" | "audio" | "fetched" | "cleared", PickCase>
const RUNS = fixture.runs as unknown as Record<"audio" | "video" | "untranscribed", RunCase>

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** Lets the pick's read of the take's job (a resolved promise here) land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Click the gallery tile of result `pickIndex` with the node in the store,
 * apply the update the click emits the way the config panel does, let the
 * pick's job read settle, and return the node as the editor then holds it.
 */
async function afterPick(c: PickCase): Promise<WorkflowNode> {
  store.nodes = [copy(c.before)]
  // The full job (GET /v1/jobs/:id) also carries input_data — for Apply EDL the
  // whole wired source transcript. A pick needs output_data only, which the lean
  // status read returns; the full read must never be made.
  getJobStatus.mockReset()
  getJobStatus.mockRejectedValue(new Error("a pick reads the lean job status, never the full job"))
  getJobStatusLean.mockReset()
  getJobStatusLean.mockImplementation(async (id: string) => {
    if (c.job && id === c.job.id) return copy(c.job)
    throw new Error("Job not found")
  })
  const onUpdate = vi.fn((patch: Record<string, unknown>) => store.updateNodeData(c.before.id, patch))
  render(<ResultsGallery nodeId={c.before.id} nodeType={c.before.type} nodeData={c.before.data} onUpdate={onUpdate} />)
  fireEvent.click(screen.getByRole("button", { name: `Result ${c.pickIndex + 1}` }))
  cleanup()
  expect(onUpdate).toHaveBeenCalledTimes(1)
  await settle()
  const node = store.nodes[0]
  store.nodes = []
  return { ...node, position: { x: 0, y: 0 } } as unknown as WorkflowNode
}

const asNode = (n: SavedNode) => ({ ...n, position: { x: 0, y: 0 } }) as unknown as WorkflowNode

/** What the editor saves (the JSON round trip drops a field the pick cleared),
 *  in the fixture's shape. */
const saved = (node: WorkflowNode) => {
  const { id, type, data } = JSON.parse(JSON.stringify(node)) as { id: string; type: string; data: Record<string, unknown> }
  return { id, type, data }
}

function consumerInputs(spec: Consumer, applyEdl: WorkflowNode): Record<string, unknown> {
  const consumer = { id: spec.id, type: spec.type, position: { x: 0, y: 0 }, data: { label: spec.type } } as unknown as WorkflowNode
  const edges = [
    { id: "e-media", source: applyEdl.id, sourceHandle: "media", target: consumer.id, targetHandle: spec.targetHandle },
    ...(spec.transcriptHandle
      ? [{ id: "e-json", source: applyEdl.id, sourceHandle: "json", target: consumer.id, targetHandle: spec.transcriptHandle }]
      : []),
  ] as unknown as WorkflowEdge[]
  return resolveNodeInputs(consumer, [applyEdl, consumer], edges) as unknown as Record<string, unknown>
}

const take = (c: PickCase) =>
  (c.before.data.generatedResults as Array<{ url: string; jobId: string; generatedJson?: unknown }>)[c.pickIndex]

describe("picking an older Apply EDL take (A1-0)", () => {
  it("video output: the pick saves the take as the node's video, with its own Transcript — the data the server test reads", async () => {
    const c = CASES.video
    const node = await afterPick(c)
    expect(saved(node)).toEqual(c.after)
    expect(node.data).not.toHaveProperty("generatedImageUrl")
  })

  it("video output: the browser engine hands the picked take downstream as video", async () => {
    const c = CASES.video
    const node = await afterPick(c)
    const picked = take(c).url
    expect(extractNodeOutput(node, "media")).toBe(picked)
    expect(extractNodeOutput(node)).toBe(picked)
    const inputs = consumerInputs(c.consumer, node)
    expect(c.consumer.receives).toBe("videoUrl")
    expect(inputs.videoUrl).toBe(picked)
  })

  it("video output: the Transcript output follows the pick, so captions are timed to the cut they burn into", async () => {
    const c = CASES.video
    const node = await afterPick(c)
    const transcript = JSON.stringify(take(c).generatedJson)
    expect(take(c).generatedJson).toBeDefined()
    expect(extractNodeOutput(node, "json")).toBe(transcript)
    const inputs = consumerInputs(c.consumer, node)
    expect(c.consumer.transcriptHandle).toBe("transcript")
    expect(inputs.transcript).toBe(transcript)
  })

  it("audio output: the pick saves the take as the node's audio and drops an earlier video render's URL", async () => {
    const c = CASES.audio
    const node = await afterPick(c)
    expect(saved(node)).toEqual(c.after)
    expect(node.data.generatedVideoUrl).toBeUndefined()
    expect(node.data).not.toHaveProperty("generatedImageUrl")
  })

  it("audio output: the browser engine hands the picked take downstream as audio", async () => {
    const c = CASES.audio
    const node = await afterPick(c)
    const picked = take(c).url
    expect(extractNodeOutput(node, "media")).toBe(picked)
    const inputs = consumerInputs(c.consumer, node)
    expect(c.consumer.receives).toBe("audioUrl")
    expect(inputs.audioUrl).toBe(picked)
    expect(inputs.videoUrl).toBeUndefined()
  })
})

describe("picking an Apply EDL take that kept no Transcript of its own (decided 2026-10-04)", () => {
  it("reads the take's Transcript back from the take's own job — the data the server test reads", async () => {
    const c = CASES.fetched
    expect(take(c).generatedJson).toBeUndefined()
    const node = await afterPick(c)
    expect(getJobStatusLean).toHaveBeenCalledTimes(1)
    expect(getJobStatusLean).toHaveBeenCalledWith(take(c).jobId)
    expect(saved(node)).toEqual(c.after)
  })

  it("reads the job's lean status (output_data only), never the full job with its input transcript", async () => {
    for (const c of [CASES.fetched, CASES.cleared]) {
      await afterPick(c)
      expect(getJobStatusLean).toHaveBeenCalledTimes(1)
      expect(getJobStatus).not.toHaveBeenCalled()
    }
  })

  it("the browser engine hands the picked take downstream with that take's Transcript", async () => {
    const c = CASES.fetched
    const node = await afterPick(c)
    const transcript = JSON.stringify(c.job?.output_data.json)
    expect(c.job?.output_data.json).toBeDefined()
    expect(extractNodeOutput(node, "json")).toBe(transcript)
    const inputs = consumerInputs(c.consumer, node)
    expect(inputs.videoUrl).toBe(take(c).url)
    expect(inputs.transcript).toBe(transcript)
  })

  it("a job whose output is another take's file leaves the Transcript output cleared — the data the server test reads", async () => {
    const c = CASES.cleared
    expect(c.job?.output_data.videoUrl).not.toBe(take(c).url)
    const node = await afterPick(c)
    expect(getJobStatusLean).toHaveBeenCalledTimes(1)
    expect(saved(node)).toEqual(c.after)
  })

  it("then the browser engine hands the picked take downstream with NO Transcript, never the one the node held before", async () => {
    const c = CASES.cleared
    expect(c.before.data.generatedJson).toBeDefined()
    const node = await afterPick(c)
    expect(extractNodeOutput(node, "json")).toBeUndefined()
    const inputs = consumerInputs(c.consumer, node)
    expect(inputs.videoUrl).toBe(take(c).url)
    expect(inputs.transcript).toBeUndefined()
  })

  it("reads no job for a take that kept its own Transcript, nor for one whose id is not a job's", async () => {
    await afterPick(CASES.video)
    expect(getJobStatusLean).not.toHaveBeenCalled()
    // `job-take-1` is not a job id (a synthetic one: `iter-…`, `exec-…`).
    expect(take(CASES.audio).jobId).toBe("job-take-1")
    await afterPick(CASES.audio)
    expect(getJobStatusLean).not.toHaveBeenCalled()
    expect(getJobStatus).not.toHaveBeenCalled()
  })
})

describe("an Apply EDL take landed by a workflow run, with no pick (A1-0)", () => {
  it("audio output: the browser engine hands the newest take downstream as audio — what the server test requires of the same data", () => {
    const c = RUNS.audio
    const node = asNode(c.after)
    const newest = (c.after.data.generatedResults as Array<{ url: string }>)[0].url
    expect(c.after.data.activeResultIndex).toBe(0)
    expect(extractNodeOutput(node, "media")).toBe(newest)
    const inputs = consumerInputs(c.consumer, node)
    expect(c.consumer.receives).toBe("audioUrl")
    expect(inputs.audioUrl).toBe(newest)
    expect(inputs.videoUrl).toBeUndefined()
  })

  it("a render cut with a transcript: the browser engine hands the newest take downstream with ITS Transcript — what the server test requires", () => {
    const c = RUNS.video
    const node = asNode(c.after)
    const newest = (c.after.data.generatedResults as Array<{ url: string; generatedJson?: unknown }>)[0]
    expect(c.after.data.activeResultIndex).toBe(0)
    expect(newest.generatedJson).toBeDefined()
    const transcript = JSON.stringify(newest.generatedJson)
    expect(extractNodeOutput(node, "json")).toBe(transcript)
    const inputs = consumerInputs(c.consumer, node)
    expect(inputs.videoUrl).toBe(newest.url)
    expect(inputs.transcript).toBe(transcript)
  })

  it("a render cut with NO transcript: the browser engine hands the newest take downstream with none, never the earlier take's", () => {
    const c = RUNS.untranscribed
    expect(c.before.data.generatedJson).toBeDefined()
    const node = asNode(c.after)
    const newest = (c.after.data.generatedResults as Array<{ url: string }>)[0].url
    expect(extractNodeOutput(node, "json")).toBeUndefined()
    const inputs = consumerInputs(c.consumer, node)
    expect(inputs.videoUrl).toBe(newest)
    expect(inputs.transcript).toBeUndefined()
  })
})

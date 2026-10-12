import { describe, it, expect, vi } from "vitest"
import type { WorkflowNode, WorkflowEdge, SubWorkflowData } from "@/types/nodes"

// Priced, so the video-fed run-start questions are the ones that speak (F5).
// Speaker View and Speaker Frames priced: video mode is open (R15).
const flag = vi.hoisted(() => ({ priced: true, frames: true }))
vi.mock("@nodaro/render-rules", async (importOriginal) => (await import("@/test-utils/speaker-view-video-gate-mock")).withVideoGate(await importOriginal<typeof import("@nodaro/render-rules")>(), flag))

// The loader reaches Supabase; every case here injects its own `load`, so the
// client is never built.
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

const { nestedWordTimingsPreflight } = await import("../sub-workflow-preflight")
const { SUB_WORKFLOW_MAX_DEPTH } = await import("../sub-workflow-route-graph")

/**
 * The word-timings refusal through SUB-WORKFLOW nodes.
 *
 * A transcribe(whisper) → add-captions chain inside a referenced workflow passed
 * every run gate — the parent graph holds neither node — and was refused MID-RUN,
 * after the parent's upstream nodes had executed and billed. The documented
 * contract is "the run does not start: nothing executes and nothing is billed",
 * so the nested graphs are walked UP FRONT, through the same loader the executor
 * runs on.
 */

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (source: string, target: string, targetHandle: string): WorkflowEdge =>
  ({ id: `${source}-${target}`, source, target, sourceHandle: "json", targetHandle }) as unknown as WorkflowEdge

const subNode = (id: string, workflowId: string, routeId = "r1"): WorkflowNode =>
  node(id, "sub-workflow", {
    referencedWorkflowId: workflowId,
    selectedRouteId: routeId,
    routeSnapshot: { inputPorts: [], outputPorts: [], visibleOutputPortId: "out" },
  })

/** A referenced graph whose transcript lane cannot produce word timings. */
const wordlessGraph = () => ({
  nodes: [node("t1", "transcribe", { label: "Inner Transcribe", provider: "whisper" }), node("c1", "add-captions")],
  edges: [edge("t1", "c1", "transcript")],
  inputNode: node("in", "sub-workflow-input"),
  outputNode: node("out", "sub-workflow-output"),
})

const cleanGraph = (nodes: WorkflowNode[] = [node("g1", "generate-image")]) => ({
  nodes,
  edges: [] as WorkflowEdge[],
  inputNode: node("in", "sub-workflow-input"),
  outputNode: node("out", "sub-workflow-output"),
})

describe("nestedWordTimingsPreflight", () => {
  it("refuses a wordless chain one level down, naming the inner node and the remedy", async () => {
    const msg = await nestedWordTimingsPreflight([subNode("s1", "wf-a")], {
      load: async () => wordlessGraph(),
    })
    expect(msg).toContain("Inner Transcribe")
    expect(msg).toContain("whisper")
    expect(msg).toContain("elevenlabs-stt")
  })

  it("refuses a chain TWO levels down — the walk recurses like the executor", async () => {
    const load = vi.fn(async (data: SubWorkflowData) =>
      data.referencedWorkflowId === "wf-a" ? cleanGraph([subNode("s2", "wf-b")]) : wordlessGraph(),
    )
    expect(await nestedWordTimingsPreflight([subNode("s1", "wf-a")], { load })).toContain("Inner Transcribe")
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("lets a nested graph with a word-capable lane run", async () => {
    const graph = wordlessGraph()
    graph.nodes[0] = node("t1", "transcribe", { provider: "elevenlabs-stt" })
    expect(await nestedWordTimingsPreflight([subNode("s1", "wf-a")], { load: async () => graph })).toBeNull()
  })

  // A reference that cannot be loaded (missing workflow, missing route, an
  // unconfigured node) is the RUN's error to report, with its own message — a
  // preflight that refused it would be answering a question it was not asked.
  it("ignores a reference it cannot load", async () => {
    expect(
      await nestedWordTimingsPreflight([subNode("s1", "wf-a")], {
        load: async () => {
          throw new Error("Referenced workflow not found")
        },
      }),
    ).toBeNull()
  })

  it("ignores an unconfigured or skipped sub-workflow node without loading anything", async () => {
    const load = vi.fn(async () => wordlessGraph())
    const unconfigured = node("s1", "sub-workflow", { referencedWorkflowId: "wf-a" }) // no routeSnapshot
    const skipped = { ...subNode("s2", "wf-a"), data: { ...subNode("s2", "wf-a").data, skipped: true } } as WorkflowNode
    expect(await nestedWordTimingsPreflight([unconfigured, skipped], { load })).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  // Self-reference through the same route is the executor's cycle case: the
  // walk must terminate, not recurse until the stack gives out.
  it("terminates on a self-referencing route", async () => {
    const load = vi.fn(async () => cleanGraph([subNode("s1", "wf-a")]))
    expect(await nestedWordTimingsPreflight([subNode("s1", "wf-a")], { load })).toBeNull()
    expect(load).toHaveBeenCalledTimes(1)
  })

  // Past the executor's own limit the run refuses with its depth message, so the
  // walk stops there too rather than inventing a different verdict.
  it("stops at the executor's depth limit", async () => {
    const load = vi.fn(async () => wordlessGraph())
    expect(
      await nestedWordTimingsPreflight([subNode("s1", "wf-a")], { depth: SUB_WORKFLOW_MAX_DEPTH, load }),
    ).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it("a run with no sub-workflow node loads nothing", async () => {
    const load = vi.fn(async () => wordlessGraph())
    expect(await nestedWordTimingsPreflight([node("g1", "generate-image")], { load })).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})

// F5 (decided 2026-10-12): the run gate walks nested graphs for a video-fed
// Speaker View's run-start refusals too.
describe("nestedRunPreflight — a video-fed Speaker View inside a sub-workflow", () => {
  it("refuses a video with no transcript, naming the inner node by its label", async () => {
    const { nestedRunPreflight } = await import("../sub-workflow-preflight")
    const msg = await nestedRunPreflight([subNode("s1", "wf-a")], {
      load: async () => cleanGraphWith(
        [node("up", "upload-video", { url: "https://cdn.example.test/a.mp4" }), node("sv", "speaker-view", { label: "Inner cut" })],
        [{ id: "up-sv", source: "up", target: "sv", sourceHandle: "video", targetHandle: "video" } as unknown as WorkflowEdge],
      ),
    })
    expect(msg).toMatch(/Transcribe/)
    expect(msg).toContain('Speaker View node "Inner cut"')
  })

  it("lets a video with its transcript through", async () => {
    const { nestedRunPreflight } = await import("../sub-workflow-preflight")
    const msg = await nestedRunPreflight([subNode("s1", "wf-a")], {
      load: async () => cleanGraphWith(
        [node("up", "upload-video", { url: "https://cdn.example.test/a.mp4" }), node("tx", "transcribe"), node("sv", "speaker-view")],
        [
          { id: "up-sv", source: "up", target: "sv", sourceHandle: "video", targetHandle: "video" } as unknown as WorkflowEdge,
          { id: "tx-sv", source: "tx", target: "sv", sourceHandle: "json", targetHandle: "transcript" } as unknown as WorkflowEdge,
        ],
      ),
    })
    expect(msg === null || !/Transcribe/.test(msg)).toBe(true)
  })
})

function cleanGraphWith(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  return { nodes, edges, inputNode: node("in", "sub-workflow-input"), outputNode: node("out", "sub-workflow-output") }
}

/**
 * The orchestrator's up-front re-host size scan (SV12, decided 2026-10-06):
 * which edits a relayed Speaker View node will be handed are KNOWN when the
 * run starts, and which of their private sources are over the re-host cap.
 */
import { describe, it, expect, vi } from "vitest"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"
import { knownEditsFor, findRelayRehostRefusals, nestedRelayRehostRefusals } from "../relay-rehost-preflight.js"

const edl = (url: string, id = "camA") => ({
  version: 1,
  clock: "master",
  sources: [{ id, url, kind: "video" }],
  segments: [{ id: "s0", inMs: 0, outMs: 1000, video: id }],
})
const seeded = (output: Record<string, unknown>): NodeExecutionState =>
  ({ status: "completed", output, completedAt: "t", fromSavedData: true }) as NodeExecutionState
const node = (id: string, type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id, type, data }) as SimpleNode
const edge = (source: string, target: string, sourceHandle: string, targetHandle: string): SimpleEdge =>
  ({ id: `${source}-${target}`, source, target, sourceHandle, targetHandle }) as SimpleEdge

describe("knownEditsFor", () => {
  it("reads an edit wired into `edl` from an upstream the run already holds (saved / outside the subset)", () => {
    const nodes = [node("ep1", "edit-plan"), node("sv1", "speaker-view")]
    const edits = knownEditsFor(nodes[1]!, nodes, [edge("ep1", "sv1", "edl", "edl")], {
      ep1: seeded({ json: edl("http://minio:9000/a.mp4") }),
    })
    expect(edits).toHaveLength(1)
    expect(JSON.stringify(edits[0])).toContain("http://minio:9000/a.mp4")
  })

  it("reads every clip of a saved clip batch (Camera Switch / Edit Plan in clips mode)", () => {
    const nodes = [node("cs1", "camera-switch"), node("sv1", "speaker-view")]
    const edits = knownEditsFor(nodes[1]!, nodes, [edge("cs1", "sv1", "edl", "edl")], {
      cs1: seeded({ json: { edl: edl("http://minio:9000/a.mp4") }, listResults: [JSON.stringify(edl("http://minio:9000/c1.mp4")), JSON.stringify(edl("http://minio:9000/c2.mp4"))] }),
    })
    expect(edits).toHaveLength(2)
  })

  it("reads an edit written on the node itself (a JSON-written node)", () => {
    const sv = node("sv1", "speaker-view", { edl: edl("http://minio:9000/a.mp4") })
    expect(knownEditsFor(sv, [sv], [], {})).toHaveLength(1)
  })

  it("knows nothing of an edit made DURING the run (an upstream with no state yet) or wired elsewhere", () => {
    const nodes = [node("ep1", "edit-plan"), node("tr1", "transcribe"), node("sv1", "speaker-view")]
    const edges = [edge("ep1", "sv1", "edl", "edl"), edge("tr1", "sv1", "json", "transcript")]
    expect(knownEditsFor(nodes[2]!, nodes, edges, { tr1: seeded({ json: edl("http://minio:9000/a.mp4") }) })).toEqual([])
  })
})

describe("findRelayRehostRefusals", () => {
  it("refuses a Speaker View node the run will execute whose known edit has a source over the cap, naming both", async () => {
    const nodes = [node("ep1", "edit-plan"), node("sv1", "speaker-view")]
    const refusals = await findRelayRehostRefusals(nodes, [edge("ep1", "sv1", "edl", "edl")], { ep1: seeded({ json: edl("http://minio:9000/a.mp4") }) }, {
      probe: async () => 3_100_000_000,
    })
    expect(refusals).toEqual([
      {
        nodeId: "sv1",
        message: 'Speaker View sends each source of the edit to nodaro.ai; "camA" is 3.1 GB, over the 500 MB limit. Use a public URL or a smaller file. (Speaker View node sv1)',
      },
    ])
  })

  it("skips a Speaker View node the run will not execute (it already has a state: frozen, outside the subset, gated)", async () => {
    const sv = node("sv1", "speaker-view", { edl: edl("http://minio:9000/a.mp4") })
    const probe = vi.fn(async () => 3_100_000_000)
    expect(await findRelayRehostRefusals([sv], [], { sv1: seeded({}) }, { probe })).toEqual([])
    expect(probe).not.toHaveBeenCalled()
  })

  it("passes when every source is within the cap or unknown, and ignores every other node type", async () => {
    const nodes = [node("sv1", "speaker-view", { edl: edl("http://minio:9000/a.mp4") }), node("cs1", "camera-switch", { edl: edl("http://minio:9000/b.mp4") })]
    expect(await findRelayRehostRefusals(nodes, [], {}, { probe: async (u) => (u.endsWith("a.mp4") ? 400_000_000 : 9_000_000_000) })).toEqual([])
    expect(await findRelayRehostRefusals(nodes.slice(0, 1), [], {}, { probe: async () => undefined })).toEqual([])
  })
})

// Review round (finding B): SV12 scans the run's nested graphs too, as the
// orchestrator's other up-front checks do — a Speaker View inside a
// sub-workflow otherwise fails only when its turn comes, after the parent's
// relayed nodes upstream have charged the connected cloud account.
describe("nestedRelayRehostRefusals", () => {
  const big = async (u: string) => (u.includes("minio") ? 3_100_000_000 : undefined)

  it("refuses a nested Speaker View whose own edit names a source over the cap, with the path to it", async () => {
    const graphs = [
      { nodes: [node("sv1", "speaker-view", { edl: edl("http://minio:9000/a.mp4") })], edges: [], subWorkflowPath: ["sw1", "sw2"] },
    ]
    expect(await nestedRelayRehostRefusals(graphs, { probe: big })).toEqual([
      {
        nodeId: "sv1",
        message:
          'Speaker View sends each source of the edit to nodaro.ai; "camA" is 3.1 GB, over the 500 MB limit. Use a public URL or a smaller file. (Sub-workflow node sw1 → sw2 → Speaker View node sv1)',
      },
    ])
  })

  it("reads an edit wired in from a FROZEN node of the nested graph — its saved data is what the nested run hands on", async () => {
    const nodes = [node("ep1", "edit-plan", { skipped: true, generatedJson: edl("http://minio:9000/a.mp4") }), node("sv1", "speaker-view")]
    const refusals = await nestedRelayRehostRefusals([{ nodes, edges: [edge("ep1", "sv1", "edl", "edl")], subWorkflowPath: ["sw1"] }], { probe: big })
    expect(refusals.map((r) => r.nodeId)).toEqual(["sv1"])
  })

  it("knows nothing of an edit a nested node makes during the run, and skips a frozen Speaker View", async () => {
    const probe = vi.fn(big)
    const running = [node("ep1", "edit-plan", { generatedJson: edl("http://minio:9000/a.mp4") }), node("sv1", "speaker-view")]
    const frozen = [node("sv2", "speaker-view", { skipped: true, edl: edl("http://minio:9000/a.mp4") })]
    expect(
      await nestedRelayRehostRefusals(
        [
          { nodes: running, edges: [edge("ep1", "sv1", "edl", "edl")], subWorkflowPath: ["sw1"] },
          { nodes: frozen, edges: [], subWorkflowPath: ["sw3"] },
        ],
        { probe },
      ),
    ).toEqual([])
    expect(probe).not.toHaveBeenCalled()
  })
})

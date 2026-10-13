/**
 * The newer run wins, the server's half. The graph is the editor's own after a
 * reopen (`fixtures/ugc-reopened-newer-run.json`, pinned by the frontend's
 * `ugc-newer-run-reopen.test.ts`): a run that ended while the editor was closed
 * replaced the older script, tickets, take and Notes. Run from here sends its
 * node and what follows it; the rest is seeded from its saved data, as the
 * orchestrator seeds it. UGC Clips must read the newer run's script; UGC Cards
 * the newer take and its notes. Over the whole video (`ugc-reopened-newer-chain.json`,
 * pinned by `ugc-newer-run-chain.test.ts`), Run from here on UGC Cards must
 * finish the newer joined video.
 */
import { describe, expect, it } from "vitest"
import { resolveNodeInputs } from "../input-resolver.js"
import { extractSavedNodeOutput, extractSourceNodeOutput } from "../output-extractor.js"
import { seededFromSavedData } from "../saved-data.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"
import reopened from "./fixtures/ugc-reopened-newer-run.json"
import reopenedChain from "./fixtures/ugc-reopened-newer-chain.json"

/** What Run from here on `start` sends (`subset`), the rest seeded from its saved data; then `node`'s inputs. */
function inputsAfterReopen(subset: ReadonlySet<string>, node: string, graph: { nodes: unknown; edges: unknown } = reopened) {
  const nodes = graph.nodes as unknown as SimpleNode[]
  const edges = graph.edges as unknown as SimpleEdge[]
  const states: Record<string, NodeExecutionState> = {}
  for (const n of nodes) if (!subset.has(n.id)) states[n.id] = seededFromSavedData(extractSavedNodeOutput(n) ?? extractSourceNodeOutput(n, {}))
  return { nodes, inputs: resolveNodeInputs(nodes.find((n) => n.id === node)!, edges, states, nodes) }
}

describe("Run from here on UGC Clips after the reopen", () => {
  it("UGC Clips reads the newer run's script, and the creator it keeps", () => {
    // What the editor sends for Run from here on UGC Clips.
    const { nodes, inputs } = inputsAfterReopen(new Set(["clips", "clip", "cards"]), "clips")
    const script = nodes.find((n) => n.id === "script")!.data as { ugcOutputs: Record<string, string>; resultsRunId: string }
    const creator = nodes.find((n) => n.id === "creator")!.data as { ugcOutputs: Record<string, string> }
    expect(script.resultsRunId).toBe("exec-2") // the newer run's
    expect(inputs.ugc?.plan).toBe(script.ugcOutputs.plan)
    expect(JSON.parse(String(inputs.ugc?.plan)).hook).not.toBe("An older opening")
    expect(inputs.ugc?.creator).toBe(creator.ugcOutputs.creator)
  })
})

describe("Run from here on UGC Cards after the reopen", () => {
  it("UGC Cards reads the newer take UGC Clip shows, and that take's notes", () => {
    const { nodes, inputs } = inputsAfterReopen(new Set(["cards"]), "cards")
    const clip = nodes.find((n) => n.id === "clip")!.data as { generatedVideoUrl: string; resultsRunId: string; durationSec: number }
    expect(clip.resultsRunId).toBe("exec-2") // the newer run's
    expect(inputs.ugc?.video).toBe(clip.generatedVideoUrl)
    expect(inputs.ugc?.video).not.toBe("https://cdn.example/older-c0.mp4")
    expect(inputs.clipNotes).toEqual(expect.arrayContaining([expect.objectContaining({ durationSec: clip.durationSec })]))
  })
})

describe("Run from here on UGC Cards after a closed-tab re-run of the whole video", () => {
  // The graph the editor reopens to (`fixtures/ugc-reopened-newer-chain.json`, pinned by the
  // frontend's ugc-newer-run-chain.test.ts): the join of the clips holds the newer joined video.
  const OLDER_JOINED = "https://cdn.example/older-joined.mp4"

  it("UGC Cards and the screenshot cards overlay finish the newer joined video, never the older one", () => {
    const join = reopenedChain.nodes.find((n) => n.id === "join")!.data as { generatedVideoUrl: string; resultsRunId: string }
    expect(join.resultsRunId).toBe("exec-2") // the newer run's
    // What the editor sends for Run from here on UGC Cards: it and what follows it.
    const subset = new Set(["cards", "overlay", "captions"])
    const cards = inputsAfterReopen(subset, "cards", reopenedChain).inputs
    expect(cards.ugc?.video).toBe(join.generatedVideoUrl)
    expect(cards.ugc?.video).not.toBe(OLDER_JOINED)
    const overlay = inputsAfterReopen(subset, "overlay", reopenedChain).inputs
    expect(overlay.videoUrl).toBe(join.generatedVideoUrl)
    expect(overlay.videoUrl).not.toBe(OLDER_JOINED)
  })
})

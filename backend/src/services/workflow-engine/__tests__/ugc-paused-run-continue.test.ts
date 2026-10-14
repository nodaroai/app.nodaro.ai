/**
 * Pause → pick → Run from here, end to end, the server's half. The graph is
 * the editor's own (`fixtures/ugc-paused-run-picked.json`, pinned by the
 * frontend's `ugc-paused-run.test.ts`: a toolbar Run's states painted, then the
 * pick). Run from here on UGC Creator sends the creator and what follows it;
 * the rest is seeded from its saved data, as the orchestrator seeds it. UGC
 * Clips must receive both wires: the script's plan and the picked creator.
 */
import { ugcKeptOutputs, ugcRunWaitsForPick } from "@nodaro/shared/ugc"
import { describe, expect, it } from "vitest"
import { resolveNodeInputs } from "../input-resolver.js"
import { extractSavedNodeOutput, extractSourceNodeOutput } from "../output-extractor.js"
import { seededFromSavedData } from "../saved-data.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"
import picked from "./fixtures/ugc-paused-run-picked.json"

describe("Run from here on UGC Creator after the pick", () => {
  it("UGC Clips receives the script's plan and the picked creator", () => {
    const nodes = picked.nodes as unknown as SimpleNode[]
    const edges = picked.edges as unknown as SimpleEdge[]
    const subset = new Set(["creator", "clips", "clip", "cards"])         // what the editor sends for Run from here on the creator
    expect(ugcRunWaitsForPick(nodes.filter((n) => subset.has(n.id)))).toBe(false)
    const states: Record<string, NodeExecutionState> = {}
    for (const n of nodes) if (!subset.has(n.id)) states[n.id] = seededFromSavedData(extractSavedNodeOutput(n) ?? extractSourceNodeOutput(n, {}))
    const creator = nodes.find((n) => n.id === "creator")!
    const kept = ugcKeptOutputs("ugc-creator", creator.data)!                  // the kept branch: no call, no charge
    expect(kept).not.toBeNull()
    states.creator = { status: "completed", nodeType: "ugc-creator", output: { ugcOutputs: kept, imageUrl: kept.image } } as NodeExecutionState
    const inputs = resolveNodeInputs(nodes.find((n) => n.id === "clips")!, edges, states, nodes)
    const script = nodes.find((n) => n.id === "script")!.data as { ugcOutputs: Record<string, string> }
    expect(inputs.ugc?.plan).toBe(script.ugcOutputs.plan)
    expect(inputs.ugc?.creator).toBe(kept.creator)
    expect(JSON.parse(kept.creator!).identityImages).toEqual([(creator.data as { generatedImageUrl: string }).generatedImageUrl])
  })
  it("the script outside the run reads as run: it is seeded, never bought again", () => {
    const script = (picked.nodes as unknown as SimpleNode[]).find((n) => n.id === "script")!
    expect(extractSavedNodeOutput(script)?.ugcOutputs?.plan).toBe((script.data as { ugcOutputs: Record<string, string> }).ugcOutputs.plan)
  })
})

// @test-watches packages/shared/src/__tests__/fixtures/speaker-map-camera-ids.json
/**
 * Speaker Map's camera ids are Edit Plan's EDL ids for the same recordings,
 * a Teleport pair included (the server's half; the editor's is
 * frontend/src/components/editor/workflow-editor/__tests__/speaker-map-camera-ids.test.ts).
 * The orchestrator bypasses teleports where it loads the graph, so this does too.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { bypassTeleports } from "@nodaro/render-rules"
import { resolveNodeInputs } from "../input-resolver.js"
import { extractSavedNodeOutput } from "../output-extractor.js"
import { buildPayload } from "../payload-builder.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

const F = JSON.parse(readFileSync(join(__dirname, "../../../../../packages/shared/src/__tests__/fixtures/speaker-map-camera-ids.json"), "utf8"))
const nodes = F.nodes as SimpleNode[]
const edges = bypassTeleports(nodes, F.edges as SimpleEdge[])
const states: Record<string, NodeExecutionState> = Object.fromEntries(
  nodes.flatMap((n) => {
    const output = extractSavedNodeOutput(n)
    return output ? [[n.id, { status: "completed", output } as NodeExecutionState]] : []
  }),
)
const node = (id: string) => nodes.find((n) => n.id === id)!

describe("Speaker Map's camera ids are the Edit Plan EDL's (server engine, through a Teleport pair)", () => {
  it("Edit Plan's wired sources and Speaker Map's Cameras rows name the same nodes", () => {
    const plan = resolveNodeInputs(node("plan"), edges, states, nodes)
    const map = resolveNodeInputs(node("map"), edges, states, nodes)
    expect(plan.editPlanSources?.map((s) => s.nodeId)).toEqual(F.expectedIds)
    expect((map.unitInputs?.sources as unknown as Array<{ id: string }>).map((r) => r.id)).toEqual(F.expectedIds)
  })

  it("the jobs: Edit Plan's EDL source ids and Speaker Map's source ids are the same", () => {
    const plan = buildPayload(node("plan"), "job-p", resolveNodeInputs(node("plan"), edges, states, nodes), "u-p").payload as { sources: Array<{ id: string }> }
    const map = buildPayload(node("map"), "job-m", resolveNodeInputs(node("map"), edges, states, nodes), "u-m").payload as { sources: Array<{ id: string }> }
    expect(plan.sources.map((s) => s.id)).toEqual(F.expectedIds)
    expect(map.sources.map((s) => s.id)).toEqual(F.expectedIds)
  })
})

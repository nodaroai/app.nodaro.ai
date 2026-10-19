// @test-watches packages/shared/src/__tests__/fixtures/camera-switch-speaker-map-parity.json
/**
 * A Speaker Map wired into Camera Switch's `speakerMap` reaches the plugin's
 * body with the same `speakerMap` from both engines (decided 2026-10-17), and
 * a wire that carries nothing, or something that is not a Speaker Map result,
 * is refused by both before the reserve. The editor half is
 * frontend/src/components/editor/workflow-editor/__tests__/camera-switch-speaker-map-parity.test.ts,
 * over the same fixture.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { cameraSwitchSettingsPayload } from "@nodaro/shared/edl"
import { cameraSwitchSpeakerMapProblem } from "@nodaro/render-rules"
import { resolveNodeInputs } from "../input-resolver.js"
import { extractSavedNodeOutput } from "../output-extractor.js"
import { buildPayload } from "../payload-builder.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

const F = JSON.parse(readFileSync(join(__dirname, "../../../../../packages/shared/src/__tests__/fixtures/camera-switch-speaker-map-parity.json"), "utf8"))

/** Every upstream node holds its saved output, as a run seeds a node it does not execute. */
function resolve(nodes: SimpleNode[], edges: SimpleEdge[]) {
  const nodeStates: Record<string, NodeExecutionState> = Object.fromEntries(
    nodes.filter((n) => n.id !== "sw").map((n) => [n.id, { status: "completed", output: extractSavedNodeOutput(n) } as NodeExecutionState]),
  )
  const sw = nodes.find((n) => n.id === "sw")!
  return { sw, inputs: resolveNodeInputs(sw, edges, nodeStates, nodes) }
}
const withMapData = (data: Record<string, unknown>) => (F.nodes as SimpleNode[]).map((n) => (n.id === "map" ? { ...n, data } : n))
const edgesWith = (edge: SimpleEdge) => (F.edges as SimpleEdge[]).map((e) => (e.id === edge.id ? edge : e))

describe("Camera Switch reads a wired Speaker Map (backend engine)", () => {
  it("the resolver lands the map on speakerMapResult, and the payload maps s0 → b, s1 → \"\"", () => {
    const { inputs } = resolve(F.nodes, F.edges)
    expect(typeof inputs.speakerMapResult).toBe("string")
    expect(cameraSwitchSpeakerMapProblem(inputs.speakerMapResult)).toBeNull()
    const body = cameraSwitchSettingsPayload({}, JSON.parse(inputs.edl!), JSON.parse(inputs.transcript!), { speakerMap: inputs.speakerMapResult })
    expect(body.speakerMap).toEqual(F.expectedSpeakerMap)
    expect(cameraSwitchSettingsPayload(F.withExplicit.data, JSON.parse(inputs.edl!), JSON.parse(inputs.transcript!), { speakerMap: inputs.speakerMapResult }).speakerMap).toEqual(F.withExplicit.expectedSpeakerMap)
  })

  it("the ordinal override carries through the built job: it beats the wired map, an explicit label beats it", () => {
    const nodes = (F.nodes as SimpleNode[]).map((n) => (n.id === "sw" ? { ...n, data: { ...n.data, ...F.withByOrder.data } } : n))
    const { sw, inputs } = resolve(nodes, F.edges)
    expect((buildPayload(sw, "job-1", inputs, "usage-1").payload as { speakerMap: unknown }).speakerMap).toEqual(F.withByOrder.expectedSpeakerMap)
  })

  it("a parameter picker wired into speakerMap is no value: read as unwired, the run goes ahead on the order default", () => {
    const { sw, inputs } = resolve(F.nodes, edgesWith(F.aPicker.edge))
    expect("speakerMapResult" in inputs).toBe(false)
    expect((buildPayload(sw, "job-1", inputs, "usage-1").payload as { speakerMap: unknown }).speakerMap).toEqual(F.aPicker.expectedSpeakerMap)
  })

  it("the built job sends the wired map", () => {
    const { sw, inputs } = resolve(F.nodes, F.edges)
    expect((buildPayload(sw, "job-1", inputs, "usage-1").payload as { speakerMap: unknown }).speakerMap).toEqual(F.expectedSpeakerMap)
  })

  it("nothing wired: no speakerMapResult, and the job is exactly what it was before the input existed", () => {
    const edges = (F.edges as SimpleEdge[]).filter((e) => e.targetHandle !== "speakerMap")
    const { sw, inputs } = resolve(F.nodes, edges)
    expect("speakerMapResult" in inputs).toBe(false)
    const edl = JSON.parse(inputs.edl!)
    const transcript = JSON.parse(inputs.transcript!)
    expect(cameraSwitchSettingsPayload({}, edl, transcript, { speakerMap: inputs.speakerMapResult })).toStrictEqual(cameraSwitchSettingsPayload({}, edl, transcript))
    expect((buildPayload(sw, "job-1", inputs, "usage-1").payload as { speakerMap: unknown }).speakerMap).toEqual(F.unwired.expectedSpeakerMap)
  })

  it("a wired Speaker Map that has not run is recorded as \"\" and refused before the reserve", () => {
    const { sw, inputs } = resolve(withMapData(F.emptyWire.mapData), F.edges)
    expect(inputs.speakerMapResult).toBe("")
    expect(cameraSwitchSpeakerMapProblem(inputs.speakerMapResult)).toBe(F.emptyWire.problem)
    expect(() => buildPayload(sw, "job-1", inputs, "usage-1")).toThrow(/Speaker map input got nothing/)
  })

  it("something that is not a Speaker Map result on the input is refused before the reserve", () => {
    const { sw, inputs } = resolve(F.nodes, edgesWith(F.notAMap.edge))
    expect(cameraSwitchSpeakerMapProblem(inputs.speakerMapResult)).toBe(F.notAMap.problem)
    expect(() => buildPayload(sw, "job-1", inputs, "usage-1")).toThrow(/not a Speaker Map result/)
  })
})

// @test-watches packages/shared/src/__tests__/fixtures/camera-switch-speaker-map-parity.json
/**
 * A Speaker Map wired into Camera Switch's `speakerMap` reaches the plugin's
 * body with the same `speakerMap` from both engines (decided 2026-10-17), and
 * both refuse a wire that carries nothing or is not a Speaker Map result. The
 * server half is backend/src/services/workflow-engine/__tests__/
 * camera-switch-speaker-map-parity.test.ts, over the same fixture. The `map`
 * node's saved generatedJson is read through the unit's `json` output.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => ({ characterDefinitions: [], nodes: [], edges: [] }) },
}))

import { cameraSwitchSettingsPayload } from "@nodaro/shared/edl"
import { cameraSwitchSpeakerMapProblem } from "@nodaro/render-rules"
import { resolveNodeInputs } from "../node-input-resolver"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const F = JSON.parse(readFileSync(join(__dirname, "../../../../../../packages/shared/src/__tests__/fixtures/camera-switch-speaker-map-parity.json"), "utf8"))

const placed = (nodes: Array<Record<string, unknown>>) => nodes.map((n) => ({ position: { x: 0, y: 0 }, ...n })) as unknown as WorkflowNode[]
function resolve(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  return resolveNodeInputs(nodes.find((n) => n.id === "sw")!, nodes, edges)
}
const withMapData = (data: Record<string, unknown>) => placed((F.nodes as Array<{ id: string }>).map((n) => (n.id === "map" ? { ...n, data } : n)))
const edgesWith = (edge: WorkflowEdge) => (F.edges as WorkflowEdge[]).map((e) => (e.id === edge.id ? edge : e))

describe("Camera Switch reads a wired Speaker Map (editor engine)", () => {
  it("the resolver lands the map on speakerMapResult, and the payload maps s0 → b, s1 → \"\"", () => {
    const inputs = resolve(placed(F.nodes), F.edges)
    expect(typeof inputs.speakerMapResult).toBe("string")
    expect(cameraSwitchSpeakerMapProblem(inputs.speakerMapResult)).toBeNull()
    const edl = JSON.parse(inputs.edl!)
    const transcript = JSON.parse(inputs.transcript!)
    expect(cameraSwitchSettingsPayload({}, edl, transcript, { speakerMap: inputs.speakerMapResult }).speakerMap).toEqual(F.expectedSpeakerMap)
    expect(cameraSwitchSettingsPayload(F.withExplicit.data, edl, transcript, { speakerMap: inputs.speakerMapResult }).speakerMap).toEqual(F.withExplicit.expectedSpeakerMap)
  })

  it("the ordinal override carries through: it beats the wired map, an explicit label beats it", () => {
    const inputs = resolve(placed(F.nodes), F.edges)
    expect(cameraSwitchSettingsPayload(F.withByOrder.data, JSON.parse(inputs.edl!), JSON.parse(inputs.transcript!), { speakerMap: inputs.speakerMapResult }).speakerMap).toEqual(F.withByOrder.expectedSpeakerMap)
  })

  it("a parameter picker wired into speakerMap is no value: read as unwired (the server's reading)", () => {
    const inputs = resolve(placed(F.nodes), edgesWith(F.aPicker.edge))
    expect("speakerMapResult" in inputs).toBe(false)
    expect(cameraSwitchSpeakerMapProblem(inputs.speakerMapResult)).toBeNull()
    expect(cameraSwitchSettingsPayload({}, JSON.parse(inputs.edl!), JSON.parse(inputs.transcript!), { speakerMap: inputs.speakerMapResult }).speakerMap).toEqual(F.aPicker.expectedSpeakerMap)
  })

  it("nothing wired: no speakerMapResult, and the settings are exactly what they were before the input existed", () => {
    const inputs = resolve(placed(F.nodes), (F.edges as WorkflowEdge[]).filter((e) => e.targetHandle !== "speakerMap"))
    expect("speakerMapResult" in inputs).toBe(false)
    const edl = JSON.parse(inputs.edl!)
    const transcript = JSON.parse(inputs.transcript!)
    expect(cameraSwitchSettingsPayload({}, edl, transcript, { speakerMap: inputs.speakerMapResult })).toStrictEqual(cameraSwitchSettingsPayload({}, edl, transcript))
    expect(cameraSwitchSettingsPayload({}, edl, transcript).speakerMap).toEqual(F.unwired.expectedSpeakerMap)
  })

  it("a wired Speaker Map that has not run is recorded as \"\" — refused, never read as unwired", () => {
    const inputs = resolve(withMapData(F.emptyWire.mapData), F.edges)
    expect(inputs.speakerMapResult).toBe("")
    expect(cameraSwitchSpeakerMapProblem(inputs.speakerMapResult)).toBe(F.emptyWire.problem)
  })

  it("something that is not a Speaker Map result on the input is refused", () => {
    const inputs = resolve(placed(F.nodes), edgesWith(F.notAMap.edge))
    expect(cameraSwitchSpeakerMapProblem(inputs.speakerMapResult)).toBe(F.notAMap.problem)
  })
})

// @vitest-environment node
// @test-watches frontend/src/nodes/**
import { describe, it, expect, vi } from "vitest"
import type { UnitDefinition } from "@/nodes/kit"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

/**
 * The render-video-sources seam with fixture units on it, added through the
 * editor's one door to the unit definitions: one whose contract.producer is
 * "video", one "dynamic" and one with no producer. execution-graph.ts names
 * none of them.
 */
vi.mock("@/lib/unit-definitions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/unit-definitions")>()
  const base = real.UNIT_NODE_DEFINITIONS[0]!
  const video = { id: "video-out", label: "Video", kind: "video", from: "generatedVideoUrl" } as const
  const fixture = (type: string, producer: UnitDefinition["producer"]): UnitDefinition => ({
    ...base, type, label: type, picker: null, outputs: ["video-out"],
    handles: { inputs: base.handles.inputs, outputs: [video] },
    producer,
  })
  const units = [...real.UNIT_NODE_DEFINITIONS, fixture("fixture-video", "video"), fixture("fixture-dynamic", "dynamic"), fixture("fixture-none", null)]
  return { ...real, UNIT_NODE_DEFINITIONS: units, unitDefinitionOf: (t: string | undefined) => units.find((u) => u.type === t) }
})

import { VIDEO_SOURCE_TYPES_FOR_RENDER, collectMediaAssets } from "../execution-graph"

const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: type, ...data } }) as any

describe("render video sources: units by contract.producer", () => {
  it("a unit producing video joins beside the legacy rows; a dynamic one and one with no producer do not", () => {
    expect(VIDEO_SOURCE_TYPES_FOR_RENDER.has("fixture-video")).toBe(true)
    expect(VIDEO_SOURCE_TYPES_FOR_RENDER.has("fixture-dynamic")).toBe(false)
    expect(VIDEO_SOURCE_TYPES_FOR_RENDER.has("fixture-none")).toBe(false)
    expect(VIDEO_SOURCE_TYPES_FOR_RENDER.has("generate-video")).toBe(true)
  })

  it("collectMediaAssets collects the video-producing unit like a legacy video source, and skips the other two", () => {
    const URL = "https://cdn.example/out"
    const render = node("r", "render-video")
    const sources = ["fixture-video", "fixture-dynamic", "fixture-none", "trim-video"].map((t) => node(t, t, { generatedVideoUrl: URL }))
    const edges = sources.map((s) => ({ id: `e-${s.id}`, source: s.id, target: "r" }))
    const assets = collectMediaAssets(render, edges as any, [...sources, render])
    expect(assets.map((a) => [a.id, a.type])).toEqual([["fixture-video", "video"], ["trim-video", "video"]])
  })
})

// @test-units-by-name composes only the in-memory fixture unit it declares, and looks the aggregates up by prototype keys only
import { describe, expect, it, vi } from "vitest"
import { insertAtPositions as manifestInsert } from "../../../../tools/units/manifest.mjs"
import type { UnitDefinition } from "@/nodes/kit"
import type { NodeTypeDefinition } from "@/types/nodes"
import type { NodeOption } from "@/lib/node-compatibility"
import {
  composeFamilyTypes, composeNodeDefinitions, composeNodeOptions, composeRecord, composeSet, insertAtPositions,
  toNodeTypeDefinition, unitNodeLabels, unitOutputTypes, unitOutputValue, unitRecord, unitsWith,
} from "../unit-compose"
import { ACCEPTS_AUDIO, ACCEPTS_MEDIA, ACCEPTS_VIDEO, unitInputAccepts } from "../ffmpeg-handles"
import { createUnitExecKit } from "@/components/editor/workflow-editor/unit-exec-kit"

/**
 * Every editor seam the node units compose through (§5.8 B PR1b,
 * tools/units/README.md), on an in-memory fixture unit: it lands where its
 * manifest says, with its handles, price and executor kit — and with no unit,
 * each seam hands its legacy table back unchanged (the real registries are
 * held to their pre-composition snapshot by units-composed-baseline.test.ts).
 */
const FIXTURE: UnitDefinition = {
  type: "fixture-echo",
  label: "Fixture Echo",
  category: "processing",
  inputs: ["in"],
  outputs: ["video-out"],
  defaultData: { label: "Fixture Echo", fieldMappings: {} },
  position: { after: "b" },
  picker: { family: "fam", after: "b", pickerCategory: "Processing", keywords: ["echo"] },
  handles: {
    inputs: [{ id: "in", label: "Video", accepts: ["video"], field: "videoUrl" }],
    outputs: [{ id: "video-out", label: "Video", kind: "video", from: "generatedVideoUrl" }],
  },
  execution: { kind: "worker", queue: "video", requires: { anyOf: ["videoUrl"], kind: "video", noun: "a video" } },
  capabilities: ["ffmpeg-media", "panel:generate-button"],
  docs: { page: "docs/nodes/processing-video/fixture-echo.md" },
  priceFallback: 3,
}
const def = (type: string) => ({ type, label: type, category: "processing", inputs: [], outputs: [], defaultData: { label: type } }) as unknown as NodeTypeDefinition
const opt = (type: string) => ({ type, label: type, icon: null, category: "Processing", group: "fam" }) as unknown as NodeOption

describe("insertAtPositions — the editor twin of tools/units/manifest.mjs", () => {
  const cases: Array<[string[], Array<{ type: string; after: string | null }>]> = [
    [["a", "b", "c"], [{ type: "x", after: "b" }]],
    [["a", "b"], [{ type: "x", after: null }, { type: "y", after: "x" }]],
    [["a", "b"], [{ type: "z", after: "a" }, { type: "y", after: "a" }]],
    [[], [{ type: "x", after: null }]],
  ]
  it.each(cases)("%j + %j", (base, units) => {
    expect(insertAtPositions(base, units)).toEqual(manifestInsert(base, units))
  })
  it("refuses an unknown place and a cycle, like the generator", () => {
    expect(() => insertAtPositions(["a"], [{ type: "x", after: "nope" }])).toThrow(/not a node type/)
    expect(() => insertAtPositions(["a"], [{ type: "x", after: "y" }, { type: "y", after: "x" }])).toThrow(/cycle/)
  })
})

describe("definitions", () => {
  const legacy = [def("a"), def("b"), def("c")]
  it("no unit: the legacy array itself", () => {
    expect(composeNodeDefinitions(legacy, [])).toBe(legacy)
  })
  it("a unit lands at its position.after, as a NodeTypeDefinition", () => {
    const composed = composeNodeDefinitions(legacy, [FIXTURE])
    expect(composed.map((d) => d.type)).toEqual(["a", "b", "fixture-echo", "c"])
    expect(composed[2]).toEqual(toNodeTypeDefinition(FIXTURE))
    expect(composed[2]).toEqual({ type: "fixture-echo", label: "Fixture Echo", category: "processing", inputs: ["in"], outputs: ["video-out"], defaultData: { label: "Fixture Echo", fieldMappings: {} } })
  })
  it("a type in both places is refused", () => {
    expect(() => composeNodeDefinitions([...legacy, def("fixture-echo")], [FIXTURE])).toThrow(/exactly one place/)
  })
})

describe("options and families", () => {
  const legacy = [opt("a"), opt("b"), opt("c")]
  const optionOf = (u: UnitDefinition) => opt(u.type)
  it("no picker unit: the legacy list itself", () => {
    expect(composeNodeOptions(legacy, [], optionOf)).toBe(legacy)
    expect(composeNodeOptions(legacy, [{ ...FIXTURE, picker: null }], optionOf)).toBe(legacy)
  })
  it("a unit's option lands after its picker.after", () => {
    expect(composeNodeOptions(legacy, [FIXTURE], optionOf).map((o) => o.type)).toEqual(["a", "b", "fixture-echo", "c"])
  })
  it("a family gains its units at picker.after; other families are untouched", () => {
    const types = ["a", "b", "c"] as const
    expect(composeFamilyTypes("fam", types, [FIXTURE])).toEqual(["a", "b", "fixture-echo", "c"])
    expect(composeFamilyTypes("other", types, [FIXTURE])).toBe(types)
    expect(() => composeFamilyTypes("fam", ["a"], [FIXTURE])).toThrow(/not in family fam/)
  })
})

describe("tables and sets", () => {
  it("composeRecord: identity with nothing to add, a merged copy otherwise, a shared key refused", () => {
    const legacy = { a: 1 }
    expect(composeRecord("T", legacy, {})).toBe(legacy)
    expect(composeRecord("T", legacy, { x: 2 })).toEqual({ a: 1, x: 2 })
    expect(legacy).toEqual({ a: 1 })
    expect(() => composeRecord("T", legacy, { a: 2 })).toThrow(/exactly one place/)
  })
  it("composeSet: identity with nothing to add, legacy order first", () => {
    const legacy = new Set(["a", "b"])
    expect(composeSet("S", legacy, [])).toBe(legacy)
    expect([...composeSet("S", legacy, ["x"])]).toEqual(["a", "b", "x"])
    expect(() => composeSet("S", legacy, ["a"])).toThrow(/exactly one place/)
  })
  it("the derived rows: price mirror, executable, capabilities, output handles", () => {
    expect(unitRecord([FIXTURE], (u) => u.priceFallback ?? undefined)).toEqual({ "fixture-echo": 3 })
    expect(unitRecord([{ ...FIXTURE, priceFallback: null }], (u) => u.priceFallback ?? undefined)).toEqual({})
    expect(unitsWith([FIXTURE], "ffmpeg-media")).toEqual(["fixture-echo"])
    expect(unitsWith([FIXTURE], "panel:run-button")).toEqual([])
    expect(unitOutputTypes(FIXTURE)).toEqual({ "video-out": "video" })
  })
})

describe("output extraction", () => {
  it("a media output prefers the active result, then the declared field", () => {
    const results = [{ url: "r0" }, { url: "r1" }]
    expect(unitOutputValue(FIXTURE, { generatedResults: results, activeResultIndex: 1, generatedVideoUrl: "f" })).toBe("r1")
    expect(unitOutputValue(FIXTURE, { generatedVideoUrl: "f" })).toBe("f")
    expect(unitOutputValue(FIXTURE, {})).toBeUndefined()
    expect(unitOutputValue(FIXTURE, { generatedVideoUrl: "f" }, "no-such-pip")).toBe("f")
  })
})

describe("connection rule of a unit input", () => {
  it("video, audio, or both = any media; another kind has no rule (the validator refuses it first)", () => {
    expect(unitInputAccepts(["video"])).toBe(ACCEPTS_VIDEO)
    expect(unitInputAccepts(["audio"])).toBe(ACCEPTS_AUDIO)
    expect(unitInputAccepts(["video", "audio"])).toBe(ACCEPTS_MEDIA)
    expect(() => unitInputAccepts(["image"])).toThrow(/ACCEPTS_KINDS/)
  })
})

describe("node labels", () => {
  it("strings.json's pt-br is the app's pt-BR", () => {
    expect(unitNodeLabels([{ "Fixture Echo": { he: "הד", "pt-br": "Eco" } }])).toEqual({ he: { "Fixture Echo": "הד" }, "pt-BR": { "Fixture Echo": "Eco" } })
  })
})

describe("the executor kit", () => {
  it("runs the job through the injected poll for THIS node, and words its errors with the node's label", async () => {
    const poll = vi.fn(async () => "https://r/out.mp4")
    const updateNodeData = vi.fn()
    const node = { id: "n1", type: "fixture-echo", position: { x: 0, y: 0 }, data: { label: "My Echo" } } as never
    const ctx = { userId: "u1" } as never
    const kit = createUnitExecKit({
      node, ctx, inputs: { videoUrl: "https://r/in.mp4" } as never, overrideMediaUrl: undefined,
      poll, setUserPromptTemplate: vi.fn(), getNodeData: () => ({ label: "My Echo" }), updateNodeData,
    })
    const start = async () => ({ jobId: "j1" })
    await expect(kit.runProcessingNode(start, "generatedVideoUrl", "Fixture Echo")).resolves.toBe("https://r/out.mp4")
    expect(poll).toHaveBeenCalledWith("n1", start, "generatedVideoUrl", "Fixture Echo", ctx)
    expect(kit.userId).toBe("u1")
    expect(kit.nodeRunError("nodeRun.noVideoInput")).toContain("My Echo")
    kit.updateNodeData({ a: 1 })
    expect(updateNodeData).toHaveBeenCalledWith("n1", { a: 1 })
    expect(kit.nodeData()).toEqual({ label: "My Echo" })
  })
})

describe("a node type that is an Object.prototype member never reaches a unit lookup", () => {
  it("every keyed editor aggregate is null-prototype", async () => {
    const aggregates = {
      ...(await import("@/nodes/_generated/components")),
      ...(await import("@/nodes/_generated/configs")),
      ...(await import("@/nodes/_generated/options")),
      ...(await import("@/nodes/_generated/executors")),
      ...(await import("@/nodes/_generated/labels")),
    } as Record<string, Readonly<Record<string, unknown>>>
    expect(Object.keys(aggregates).sort()).toEqual(["UNIT_COMPONENTS", "UNIT_CONFIGS", "UNIT_EXECUTORS", "UNIT_LABELS", "UNIT_OPTIONS"])
    for (const [name, agg] of Object.entries(aggregates)) {
      for (const k of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) expect(agg[k], `${name}[${k}]`).toBeUndefined()
    }
  })
})

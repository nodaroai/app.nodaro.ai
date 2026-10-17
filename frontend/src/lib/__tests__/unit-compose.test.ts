// @test-units-by-name composes only the in-memory fixture unit it declares, and looks the aggregates up by prototype keys only
// @test-watches frontend/src/nodes/_generated/*.ts
import { describe, expect, it, vi } from "vitest"
import { insertAtPositions as manifestInsert } from "../../../../tools/units/manifest.mjs"
import type { UnitDefinition } from "@/nodes/kit"
import type { NodeTypeDefinition } from "@/types/nodes"
import type { NodeOption } from "@/lib/node-compatibility"
import {
  composeFamilyTypes, composeNodeDefinitions, composeNodeOptions, composeRecord, composeRecordAfter, composeSet, insertAtPositions,
  toNodeTypeDefinition, unitNodeLabels, unitOutputTypes, unitOutputValue, unitRecord, unitsWith,
} from "../unit-compose"
import { ACCEPTS_AUDIO, ACCEPTS_MEDIA, ACCEPTS_VIDEO, unitInputAccepts } from "../ffmpeg-handles"
import { createUnitExecKit } from "@/components/editor/workflow-editor/unit-exec-kit"
// The aggregates' own source (Vite ?raw — a module edge, no file read): their
// unit imports are stubbed below, so the check loads the aggregates alone and
// never a unit's canvas component (BaseNode, the ee hooks …), which made it
// seconds slow and flaky under the parallel suite.
import componentsSrc from "@/nodes/_generated/components?raw"
import configsSrc from "@/nodes/_generated/configs?raw"
import optionsSrc from "@/nodes/_generated/options?raw"
import executorsSrc from "@/nodes/_generated/executors?raw"
import labelsSrc from "@/nodes/_generated/labels?raw"

/**
 * Every editor seam the node units compose through (§5.8 B PR1b,
 * tools/units/README.md), on an in-memory fixture unit: it lands where its
 * manifest says, with its handles, price and executor kit — and with no unit,
 * each seam hands its legacy table back unchanged.
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
  it("composeRecordAfter: an ordered record keeps the legacy order and places each unit after its first present anchor", () => {
    const legacy = { a: 1, b: 2, c: 3 }
    expect(composeRecordAfter("T", legacy, [])).toBe(legacy)
    expect(Object.keys(composeRecordAfter("T", legacy, [{ type: "x", anchors: ["b", "c"], value: 9 }]))).toEqual(["a", "b", "x", "c"])
    // The first anchor is not a key here: the next one is used; none present (or null) → last.
    expect(Object.keys(composeRecordAfter("T", legacy, [{ type: "x", anchors: [null, "missing", "a"], value: 9 }]))).toEqual(["a", "x", "b", "c"])
    expect(Object.keys(composeRecordAfter("T", legacy, [{ type: "x", anchors: [undefined, "missing"], value: 9 }]))).toEqual(["a", "b", "c", "x"])
    // Two units at one key keep type order.
    expect(Object.keys(composeRecordAfter("T", legacy, [{ type: "z", anchors: ["a"], value: 0 }, { type: "y", anchors: ["a"], value: 0 }]))).toEqual(["a", "y", "z", "b", "c"])
    expect(composeRecordAfter("T", legacy, [{ type: "x", anchors: ["a"], value: 9 }]).x).toBe(9)
    expect(legacy).toEqual({ a: 1, b: 2, c: 3 })
    // A unit may follow another unit (a chain), whichever order they are listed in; the anchor
    // of a unit at the end carries its followers there too; a cycle (or a self-anchor) throws.
    expect(Object.keys(composeRecordAfter("T", legacy, [{ type: "y", anchors: ["x"], value: 0 }, { type: "x", anchors: ["a"], value: 0 }]))).toEqual(["a", "x", "y", "b", "c"])
    expect(Object.keys(composeRecordAfter("T", legacy, [{ type: "y", anchors: ["missing", "x"], value: 0 }, { type: "x", anchors: ["missing"], value: 0 }]))).toEqual(["a", "b", "c", "x", "y"])
    expect(() => composeRecordAfter("T", legacy, [{ type: "x", anchors: ["y"], value: 0 }, { type: "y", anchors: ["x"], value: 0 }])).toThrow(/cycle: x, y/)
    expect(Object.keys(composeRecordAfter("T", legacy, [{ type: "x", anchors: ["x", "b"], value: 0 }]))).toEqual(["a", "b", "x", "c"])
    expect(() => composeRecordAfter("T", legacy, [{ type: "a", anchors: [], value: 0 }])).toThrow(/exactly one place/)
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


/** `import { X as y } from "../<unit>/<module>"` lines of an aggregate → [module path, export name]. */
const unitMembers = (src: string): Array<[string, string]> =>
  [...src.matchAll(/^import \{ (\w+) as \w+ \} from "\.\.\/([a-z][a-z0-9-]*\/[\w.-]+)"/gm)].map((m) => [`@/nodes/${m[2]}`, m[1]!])

describe("a node type that is an Object.prototype member never reaches a unit lookup", () => {
  it("every keyed editor aggregate is null-prototype", async () => {
    const members = [componentsSrc, configsSrc, optionsSrc, executorsSrc, labelsSrc].flatMap(unitMembers)
    expect(members.length, "the aggregates import their units (the regex still reads them)").toBeGreaterThan(0)
    vi.resetModules()
    for (const [path, name] of members) vi.doMock(path, () => ({ [name]: { stub: path } }))
    const aggregates = {
      ...(await import("@/nodes/_generated/components")),
      ...(await import("@/nodes/_generated/configs")),
      ...(await import("@/nodes/_generated/options")),
      ...(await import("@/nodes/_generated/executors")),
      ...(await import("@/nodes/_generated/labels")),
    } as Record<string, Readonly<Record<string, unknown>>>
    for (const [path] of members) vi.doUnmock(path)
    expect(Object.keys(aggregates).sort()).toEqual(["UNIT_COMPONENTS", "UNIT_CONFIGS", "UNIT_EXECUTORS", "UNIT_LABELS", "UNIT_OPTIONS"])
    for (const [name, agg] of Object.entries(aggregates)) {
      expect(Object.values(agg).length, `${name} holds its units`).toBeGreaterThan(0)
      expect(Object.values(agg).every((v) => typeof v === "object" && v !== null && "stub" in v), `${name}: only stubbed unit modules were loaded`).toBe(true)
      for (const k of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) expect(agg[k], `${name}[${k}]`).toBeUndefined()
    }
  })
})

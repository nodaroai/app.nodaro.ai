// @test-units-by-name composes only the in-memory fixture unit it declares, and looks the aggregates up by prototype keys only
// @test-watches frontend/src/nodes/_generated/*.ts
import { describe, expect, it, vi } from "vitest"
import { insertAtPositions as manifestInsert } from "../../../../tools/units/manifest.mjs"
import type { UnitDefinition } from "@/nodes/kit"
import type { NodeTypeDefinition } from "@/types/nodes"
import type { NodeOption } from "@/lib/node-compatibility"
import {
  composeFamilyTypes, composeNodeDefinitions, composeTabSuperset, composeNodeOptions, composeRecord, composeRecordAfter, composeSet, insertAtPositions,
  jsonListItems, toNodeTypeDefinition, unitJobLanding, unitJsonJobLanding, unitJsonProducers, unitJsonRunPatch, unitJsonWorkers, unitNoMediumResults, unitNodeLabels,
  unitOutputTypes, unitOutputValue, unitPipJson, unitPriceRows, unitProducers, unitRecord, unitsWith, unitTabSuperset, unitTextSources,
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
  producer: "video",
  docs: { page: "docs/nodes/processing-video/fixture-echo.md" },
  priceRows: { "fixture-echo": 3, "fixture-echo:hd": 6 },
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
  it("first in its family (picker.after null): placed after its position.after, not first in the list", () => {
    const familyFirst: UnitDefinition = { ...FIXTURE, position: { after: "b" }, picker: { family: "fam", after: null } }
    expect(composeNodeOptions(legacy, [familyFirst], optionOf).map((o) => o.type)).toEqual(["a", "b", "fixture-echo", "c"])
    // A unit placed first in NODE_DEFINITIONS too is first here.
    expect(composeNodeOptions(legacy, [{ ...familyFirst, position: { after: null } }], optionOf).map((o) => o.type)).toEqual(["fixture-echo", "a", "b", "c"])
    // A position.after with no option of its own names nothing here: refused loudly, never appended silently.
    expect(() => composeNodeOptions(legacy, [{ ...familyFirst, position: { after: "no-option" } }], optionOf)).toThrow(/fixture-echo: picker\.after is null \(first in its family\), so the add-node list places it after position\.after "no-option" — which has no add-node option/)
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
    // The first anchor is a node with no row here: the next one is used; none present (or null) → last.
    const noRow = new Set(["missing"])
    expect(Object.keys(composeRecordAfter("T", legacy, [{ type: "x", anchors: [null, "missing", "a"], value: 9 }], noRow))).toEqual(["a", "x", "b", "c"])
    expect(Object.keys(composeRecordAfter("T", legacy, [{ type: "x", anchors: [undefined, "missing"], value: 9 }], noRow))).toEqual(["a", "b", "c", "x"])
    // An anchor that names nothing (no row here, not a known name outside) throws instead of appending.
    expect(() => composeRecordAfter("T", legacy, [{ type: "x", anchors: ["nowhere", "a"], value: 9 }], noRow)).toThrow(/T: x's anchor "nowhere" names nothing/)
    expect(() => composeRecordAfter("T", legacy, [{ type: "x", anchors: ["missing"], value: 9 }])).toThrow(/names nothing/)
    // Two units at one key keep type order.
    expect(Object.keys(composeRecordAfter("T", legacy, [{ type: "z", anchors: ["a"], value: 0 }, { type: "y", anchors: ["a"], value: 0 }]))).toEqual(["a", "y", "z", "b", "c"])
    expect(composeRecordAfter("T", legacy, [{ type: "x", anchors: ["a"], value: 9 }]).x).toBe(9)
    expect(legacy).toEqual({ a: 1, b: 2, c: 3 })
    // A unit may follow another unit (a chain), whichever order they are listed in; the anchor
    // of a unit at the end carries its followers there too; a cycle (or a self-anchor) throws.
    expect(Object.keys(composeRecordAfter("T", legacy, [{ type: "y", anchors: ["x"], value: 0 }, { type: "x", anchors: ["a"], value: 0 }]))).toEqual(["a", "x", "y", "b", "c"])
    expect(Object.keys(composeRecordAfter("T", legacy, [{ type: "y", anchors: ["missing", "x"], value: 0 }, { type: "x", anchors: ["missing"], value: 0 }], noRow))).toEqual(["a", "b", "c", "x", "y"])
    expect(() => composeRecordAfter("T", legacy, [{ type: "x", anchors: ["y"], value: 0 }, { type: "y", anchors: ["x"], value: 0 }])).toThrow(/cycle: x, y/)
    expect(Object.keys(composeRecordAfter("T", legacy, [{ type: "x", anchors: ["x", "b"], value: 0 }]))).toEqual(["a", "b", "x", "c"])
    expect(() => composeRecordAfter("T", legacy, [{ type: "a", anchors: [], value: 0 }])).toThrow(/exactly one place/)
  })
  it("the derived rows: price mirror, executable, capabilities, output handles", () => {
    // Every staticCosts row of each unit; a credit id priced by two units is refused (unitStaticCosts' twin).
    expect(unitPriceRows([FIXTURE])).toEqual({ "fixture-echo": 3, "fixture-echo:hd": 6 })
    expect(unitPriceRows([{ ...FIXTURE, priceRows: {} }])).toEqual({})
    expect(unitPriceRows([])).toEqual({})
    expect(() => unitPriceRows([FIXTURE, { ...FIXTURE, type: "other", priceRows: { "fixture-echo:hd": 6 } }])).toThrow(/other: credit id "fixture-echo:hd" is priced by another unit too/)
    expect(unitRecord([FIXTURE], (u) => u.label)).toEqual({ "fixture-echo": "Fixture Echo" })
    expect(unitsWith([FIXTURE], "ffmpeg-media")).toEqual(["fixture-echo"])
    expect(unitsWith([FIXTURE], "panel:run-button")).toEqual([])
    expect(unitOutputTypes(FIXTURE)).toEqual({ "video-out": "video" })
  })
})

describe("the derived editor sets", () => {
  const out = (id: string, kind: UnitDefinition["handles"]["outputs"][number]["kind"], extra: object = {}) => ({ id, label: id, kind, ...extra })
  const unit = (type: string, outputs: UnitDefinition["handles"]["outputs"], capabilities: string[] = []): UnitDefinition =>
    ({ ...FIXTURE, type, handles: { inputs: [], outputs }, capabilities })
  const notes = unit("notes", [out("text", "text"), out("json", "look")], ["panel:generate-button"])
  const plan = unit("plan", [out("media", "video", { runtimeTyped: true }), out("json", "look")], ["panel:run-button"])
  const silent = unit("silent", [out("json", "look")])
  const textSecond = unit("text-second", [out("video", "video"), out("text", "text")], ["panel:generate-button"])

  it("a runtime-typed pip has no HANDLE_OUTPUT_TYPES row; its typed siblings do", () => {
    expect(unitOutputTypes(plan)).toEqual({ json: "look" })
    expect(unitOutputTypes(notes)).toEqual({ text: "text", json: "look" })
  })
  it("text sources: units whose FIRST output is text (what an edge naming no pip reads)", () => {
    expect(unitTextSources([notes, plan, silent, textSecond])).toEqual(["notes"])
    expect(unitTextSources([])).toEqual([])
  })
  it("JSON producers: units with any look output", () => {
    expect(unitJsonProducers([notes, plan, silent, textSecond])).toEqual(["notes", "plan", "silent"])
  })
  it("producers: the units whose contract.producer is the kind asked for", () => {
    const of = (type: string, producer: UnitDefinition["producer"]): UnitDefinition => ({ ...FIXTURE, type, producer })
    const units = [of("v", "video"), of("dyn", "dynamic"), of("a", "audio"), of("none", null), of("v2", "video")]
    expect(unitProducers(units, "video")).toEqual(["v", "v2"])
    expect(unitProducers(units, "audio")).toEqual(["a"])
    expect(unitProducers(units, "image")).toEqual([])
    expect(unitProducers([], "video")).toEqual([])
  })
  it("no-medium results: gallery units (Generate or Run button) with no video, audio or image output", () => {
    // plan's media pip is runtime-typed but still a medium; silent has no gallery; text-second carries video.
    expect(unitNoMediumResults([notes, plan, silent, textSecond])).toEqual(["notes"])
    expect(unitNoMediumResults([FIXTURE])).toEqual([])
  })
  it("tab superset: tab → family → its units shown there too, in family order", () => {
    const shown = (type: string, family: string, alsoOnTabs?: string[]): UnitDefinition =>
      ({ ...FIXTURE, type, picker: { family, after: null, ...(alsoOnTabs ? { alsoOnTabs } : {}) } })
    const familyTypes = (id: string) => (id === "pod" ? ["first", "second", "third"] : id === "refs" ? ["r1"] : [])
    expect(unitTabSuperset([], familyTypes)).toEqual({})
    expect(unitTabSuperset([shown("second", "pod")], familyTypes)).toEqual({})
    expect(unitTabSuperset([{ ...FIXTURE, picker: null }], familyTypes)).toEqual({})
    // Listed out of family order: sorted by it; two tabs at once; another family on the same tab.
    expect(unitTabSuperset([shown("third", "pod", ["audio"]), shown("first", "pod", ["audio", "image"]), shown("r1", "refs", ["audio"])], familyTypes))
      .toEqual({ audio: { pod: ["first", "third"], refs: ["r1"] }, image: { pod: ["first"] } })
  })
  it("TAB_SUPERSET merge: legacy itself with no unit row; a unit appended, then its family's members in family order", () => {
    const familyTypes = (id: string) => (id === "pod" ? ["first", "second", "third"] : [])
    const legacy = { audio: { pod: ["third"], own: ["other-family", "x"] }, video: { add: ["link", "text"] } }
    expect(composeTabSuperset(legacy, {}, familyTypes)).toBe(legacy)
    const merged = composeTabSuperset(legacy, { audio: { pod: ["first"], add: ["y"] }, image: { pod: ["second"] } }, familyTypes)
    expect(merged).toEqual({ audio: { pod: ["first", "third"], own: ["other-family", "x"], add: ["y"] }, video: { add: ["link", "text"] }, image: { pod: ["second"] } })
    expect(legacy.audio.pod).toEqual(["third"])
    // A type from another family keeps its slot; the family's own members are re-sorted around it.
    expect(composeTabSuperset({ audio: { pod: ["third", "text"] } }, { audio: { pod: ["first"] } }, familyTypes).audio?.pod).toEqual(["first", "text", "third"])
    expect(() => composeTabSuperset(legacy, { audio: { pod: ["third"] } }, familyTypes)).toThrow(/exactly one place/)
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

// A JSON-only worker, Speaker Map's shape: `json` (primary) and `edl`.
const MAP: UnitDefinition = {
  ...FIXTURE,
  type: "fixture-map",
  handles: {
    inputs: [],
    outputs: [{ id: "json", label: "Map", kind: "look", from: "generatedJson" }, { id: "edl", label: "EDL", kind: "look", from: "generatedEdl" }],
  },
}

describe("a worker unit's JSON (look) outputs", () => {
  it("unitOutputValue: a look output reads its field as the JSON string a wire carries", () => {
    expect(unitOutputValue(MAP, { generatedJson: { a: 1 } }, "json")).toBe('{"a":1}')
    expect(unitOutputValue(MAP, { generatedEdl: '{"a":1}' }, "edl")).toBe('{"a":1}')
    expect(unitOutputValue(MAP, { generatedJson: { a: 1 } })).toBe('{"a":1}')
    expect(unitOutputValue(MAP, { generatedJson: "" }, "json")).toBeUndefined()
    expect(unitOutputValue(MAP, {}, "edl")).toBeUndefined()
  })
  it("unitJobLanding: each look output's output_data[<id>] on its field — a JSON string as its value, an absent one cleared; other keys dropped", () => {
    expect(unitJobLanding(MAP, { json: { a: 1 }, videoUrl: "x" })).toEqual({ generatedJson: { a: 1 } })
    const landed = unitJobLanding(MAP, { json: { a: 1 }, videoUrl: "x" })
    expect(Object.hasOwn(landed, "generatedEdl") && landed.generatedEdl === undefined).toBe(true)
    expect(unitJobLanding(MAP, { edl: '{"b":2}', json: "" })).toEqual({ generatedEdl: { b: 2 } })
    expect(unitJobLanding(MAP, { json: "plain text" })).toEqual({ generatedJson: "plain text" })
    expect(unitJobLanding(FIXTURE, { "video-out": "x" })).toEqual({})
  })
  it("unitJsonWorkers: worker units with look outputs (never a use case, never a media worker)", () => {
    const useCase = { ...MAP, type: "case", execution: { kind: "use-case" } } as unknown as UnitDefinition
    expect(unitJsonWorkers([FIXTURE, MAP, useCase]).map((u) => u.type)).toEqual(["fixture-map"])
  })
  it("unitJsonRunPatch: a server run's node output (unitOutputs, or json alone) as the landing; nothing to land → undefined", () => {
    expect(unitJsonRunPatch(MAP, { unitOutputs: { json: '{"a":1}', edl: '{"b":2}' }, json: { a: 1 } })).toEqual({ generatedJson: { a: 1 }, generatedEdl: { b: 2 } })
    expect(unitJsonRunPatch(MAP, { json: { a: 1 } })).toEqual({ generatedJson: { a: 1 } })
    expect(unitJsonRunPatch(MAP, { unitOutputs: {} })).toBeUndefined()
    expect(unitJsonRunPatch(MAP, {})).toBeUndefined()
  })
  it("unitPipJson: the wired look pip's value (a JSON string parsed), wrapped; undefined off a media pip or a use case", () => {
    expect(unitPipJson(MAP, { generatedJson: { a: 1 }, generatedEdl: '{"b":2}' }, "edl")).toEqual({ value: { b: 2 } })
    expect(unitPipJson(MAP, { generatedJson: { a: 1 } }, null)).toEqual({ value: { a: 1 } })
    expect(unitPipJson(MAP, { generatedJson: { a: 1 } }, "edl")).toEqual({ value: undefined })
    expect(unitPipJson(FIXTURE, { generatedVideoUrl: "x" }, "video-out")).toBeUndefined()
    expect(unitPipJson({ ...MAP, execution: { kind: "use-case" } } as unknown as UnitDefinition, { generatedJson: { a: 1 } }, "json")).toBeUndefined()
  })
  it("jsonListItems: an array's elements, an object one item, a value its text, nothing for null/undefined", () => {
    expect(jsonListItems([{ a: 1 }, "s", null, 2])).toEqual(['{"a":1}', "s", "2"])
    expect(jsonListItems({ a: 1 })).toEqual(['{"a":1}'])
    expect(jsonListItems(5)).toEqual(["5"])
    expect(jsonListItems(null)).toEqual([])
    expect(jsonListItems(undefined)).toEqual([])
  })
  it("unitJsonJobLanding: the fields a run clears at its start, and a job's patch plus the primary output as a wire carries it", () => {
    const landing = unitJsonJobLanding(MAP)
    expect(landing.fields).toEqual(["generatedJson", "generatedEdl"])
    expect(landing.land({ json: { a: 1 }, edl: { b: 2 } })).toEqual({ patch: { generatedJson: { a: 1 }, generatedEdl: { b: 2 } }, result: '{"a":1}' })
    expect(landing.land({ edl: { b: 2 } })).toEqual({ patch: { generatedEdl: { b: 2 } }, result: "" })
    expect(landing.land({ videoUrl: "x" })).toBeUndefined()
  })
})

describe("connection rule of a unit input", () => {
  it("video, audio, image, or both media = any media; another kind has no rule (the validator refuses it first)", () => {
    expect(unitInputAccepts(["video"])).toBe(ACCEPTS_VIDEO)
    expect(unitInputAccepts(["audio"])).toBe(ACCEPTS_AUDIO)
    expect(unitInputAccepts(["video", "audio"])).toBe(ACCEPTS_MEDIA)
    expect(typeof unitInputAccepts(["image"])).toBe("function") // equal to ACCEPTS_IMAGE_OR_DYN: unit-connections.test.ts
    expect(() => unitInputAccepts(["text"])).toThrow(/ACCEPTS_KINDS/)
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
      poll, pollJson: vi.fn(), setUserPromptTemplate: vi.fn(), getNodeData: () => ({ label: "My Echo" }), updateNodeData,
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

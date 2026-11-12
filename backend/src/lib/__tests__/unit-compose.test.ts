// @test-units-by-name composes only the in-memory fixture unit it declares, and looks the aggregates up by prototype keys only
import { describe, expect, it } from "vitest"
import type { UnitDescriptor, UnitPrice } from "../../nodes/kit.js"
import {
  composeRecord, composeRecordSorted, composeSet, isUnitJsonWorker, placeAfter, registryCategoryOf, unitHasSideOutputs, unitJobOutput, unitListItems,
  unitListPipItems, unitListPipOf, unitLookPipOf, unitPipJson, unitPipKindOf, unitPipValue, unitProducers, unitProviderOf, unitRecord, unitSavedOutput,
  unitStaticCosts, unitsWith, unitTakePipOf,
} from "../unit-compose.js"

/**
 * Every server seam the node units compose through (§5.8 B PR1b,
 * tools/units/README.md), on an in-memory fixture unit — and with no unit,
 * each hands its legacy table back unchanged.
 */
const FIXTURE: UnitDescriptor = {
  type: "fixture-echo",
  label: "Fixture Echo",
  category: "processing",
  description: "Echo the input video back unchanged.",
  outputType: "video",
  position: { after: "b" },
  inputs: ["in"],
  outputs: ["video-out"],
  handles: {
    inputs: [{ id: "in", label: "Video", accepts: ["video"], field: "videoUrl" }],
    outputs: [{ id: "video-out", label: "Video", kind: "video", from: "generatedVideoUrl" }],
  },
  execution: { kind: "worker", queue: "video", requires: { anyOf: ["videoUrl"], kind: "video", noun: "a video" } },
  capabilities: ["finalize:own-writer", "length:pass-video"],
  producer: "video",
}
const PRICE: UnitPrice = { staticCosts: { "fixture-echo": 3, "fixture-echo:hd": 6 }, creditId: (d) => (d.hd ? "fixture-echo:hd" : "fixture-echo") }

describe("tables and sets", () => {
  it("composeRecord: identity with nothing to add, a merged copy otherwise (legacy never mutated), a shared key refused", () => {
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
  it("composeRecordSorted: each unit row at its place in the table's type order; legacy order kept", () => {
    const legacy = { "apply-edl": 1, "extract-audio": 2, "remove-background": 3 }
    expect(composeRecordSorted("T", legacy, {})).toBe(legacy)
    expect(Object.keys(composeRecordSorted("T", legacy, { "remove-audio": 9, "a-first": 0, "zz-last": 0 }))).toEqual(["a-first", "apply-edl", "extract-audio", "remove-audio", "remove-background", "zz-last"])
    expect(composeRecordSorted("T", legacy, { "remove-audio": 9 })["remove-audio"]).toBe(9)
    expect(legacy).toEqual({ "apply-edl": 1, "extract-audio": 2, "remove-background": 3 })
    expect(() => composeRecordSorted("T", legacy, { "apply-edl": 0 })).toThrow(/exactly one place/)
  })
  it("capabilities, required media and handle rows", () => {
    expect(unitsWith([FIXTURE], "finalize:own-writer")).toEqual(["fixture-echo"])
    expect(unitsWith([FIXTURE], "ffmpeg-media")).toEqual([])
    expect(unitRecord([FIXTURE], (u) => u.execution.requires)).toEqual({ "fixture-echo": { anyOf: ["videoUrl"], kind: "video", noun: "a video" } })
    expect(unitRecord([FIXTURE], (u) => ({ inputs: u.inputs, outputs: u.outputs }))).toEqual({ "fixture-echo": { inputs: ["in"], outputs: ["video-out"] } })
  })
})

describe("registry order", () => {
  const legacy = [{ type: "a" }, { type: "b" }, { type: "c" }]
  const entry = { type: "fixture-echo" }
  const editorOnly = new Set(["only-in-the-editor"])
  it("after its position.after; first for null; last when the anchor is a node this registry does not carry", () => {
    expect(placeAfter(legacy, (d) => d.type, [{ type: "fixture-echo", after: "b", entry }]).map((d) => d.type)).toEqual(["a", "b", "fixture-echo", "c"])
    expect(placeAfter(legacy, (d) => d.type, [{ type: "fixture-echo", after: null, entry }]).map((d) => d.type)).toEqual(["fixture-echo", "a", "b", "c"])
    expect(placeAfter(legacy, (d) => d.type, [{ type: "fixture-echo", after: "only-in-the-editor", entry }], editorOnly).map((d) => d.type)).toEqual(["a", "b", "c", "fixture-echo"])
    expect(placeAfter(legacy, (d) => d.type, [])).toEqual(legacy)
  })
  it("a unit may follow another unit; a cycle throws instead of dropping them", () => {
    const u = (type: string, after: string | null) => ({ type, after, entry: { type } })
    expect(placeAfter(legacy, (d) => d.type, [u("y", "x"), u("x", "a")]).map((d) => d.type)).toEqual(["a", "x", "y", "b", "c"])
    expect(placeAfter(legacy, (d) => d.type, [u("y", "x"), u("x", "only-in-the-editor")], editorOnly).map((d) => d.type)).toEqual(["a", "b", "c", "x", "y"])
    expect(placeAfter(legacy, (d) => d.type, [u("x", "a"), u("w", "a")]).map((d) => d.type)).toEqual(["a", "w", "x", "b", "c"])
    expect(() => placeAfter(legacy, (d) => d.type, [u("x", "y"), u("y", "x")])).toThrow(/cycle: x, y/)
    expect(() => placeAfter(legacy, (d) => d.type, [u("x", "x")])).toThrow(/cycle: x/)
  })
  it("an anchor that names nothing throws instead of silently appending the unit", () => {
    expect(() => placeAfter(legacy, (d) => d.type, [{ type: "fixture-echo", after: "no-such-node", entry }])).toThrow(/fixture-echo's anchor "no-such-node" names nothing/)
    expect(() => placeAfter(legacy, (d) => d.type, [{ type: "fixture-echo", after: "no-such-node", entry }], editorOnly)).toThrow(/names nothing/)
    // A characterization anchors on an operation name; the default knows nothing outside the collection.
    expect(() => placeAfter(legacy, (d) => d.type, [{ type: "fixture-echo", after: "only-in-the-editor", entry }])).toThrow(/names nothing/)
  })
  it("the /v1/nodes category is the manifest's when the server shares it", () => {
    expect(registryCategoryOf(FIXTURE, ["input", "processing"])).toBe("processing")
    expect(() => registryCategoryOf({ ...FIXTURE, category: "ai" }, ["input", "processing"])).toThrow(/no \/v1\/nodes category/)
  })
  it("a unit whose category the server lacks is listed under its registry.category, one of every /v1/nodes category", () => {
    const AI = { ...FIXTURE, category: "ai", registryCategory: "ai-image" }
    expect(registryCategoryOf(AI, ["input", "processing"], ["input", "processing", "ai-image"])).toBe("ai-image")
    // registry.category wins over a shared category too (the validator refuses that pair; the reader never guesses).
    expect(registryCategoryOf({ ...FIXTURE, registryCategory: "ai-image" }, ["input", "processing"], ["ai-image", "processing"])).toBe("ai-image")
    expect(() => registryCategoryOf({ ...AI, registryCategory: "ai-nope" }, ["input", "processing"], ["input", "processing", "ai-image"])).toThrow(/registry\.category "ai-nope" is no \/v1\/nodes category/)
    // With no server list given, only the shared ones are known.
    expect(() => registryCategoryOf(AI, ["input", "processing"])).toThrow(/is no \/v1\/nodes category/)
  })
  it("unitProducers: the units of one contract.producer, in collection order", () => {
    const image = { ...FIXTURE, type: "fixture-image", producer: "image" as const }
    expect(unitProducers([FIXTURE, image, { ...FIXTURE, type: "fixture-none", producer: null }], "image")).toEqual(["fixture-image"])
    expect(unitProducers([FIXTURE, image], "video")).toEqual(["fixture-echo"])
    expect(unitProducers([], "image")).toEqual([])
  })
  it("unitProviderOf: the provider its one provider:* capability names", () => {
    expect(unitProviderOf({ ...FIXTURE, capabilities: ["lane:provider", "provider:kie"] })).toBe("kie")
    expect(unitProviderOf(FIXTURE)).toBeUndefined()
    expect(unitProviderOf(undefined)).toBeUndefined()
  })
})

describe("prices", () => {
  it("every unit's static rows merge; a credit id priced by two units is refused", () => {
    expect(unitStaticCosts({ "fixture-echo": PRICE })).toEqual({ "fixture-echo": 3, "fixture-echo:hd": 6 })
    expect(unitStaticCosts({})).toEqual({})
    expect(() => unitStaticCosts({ "fixture-echo": PRICE, other: { ...PRICE } })).toThrow(/priced by another unit/)
    expect(PRICE.creditId?.({ hd: true })).toBe("fixture-echo:hd")
  })
})

describe("saved output", () => {
  it("<kind>Url from the active result, else the declared field; nothing saved → undefined", () => {
    expect(unitSavedOutput(FIXTURE, { generatedResults: [{ url: "r0" }, { url: "r1" }], activeResultIndex: 1, generatedVideoUrl: "f" })).toEqual({ videoUrl: "r1" })
    expect(unitSavedOutput(FIXTURE, { generatedVideoUrl: "f" })).toEqual({ videoUrl: "f" })
    expect(unitSavedOutput(FIXTURE, {})).toBeUndefined()
  })
})

// A JSON-only worker, Speaker Map's shape: `json` (primary) and `edl`.
const MAP: UnitDescriptor = {
  ...FIXTURE,
  type: "fixture-map",
  outputType: "data",
  outputs: ["json", "edl"],
  handles: {
    inputs: [],
    outputs: [{ id: "json", label: "Map", kind: "look", from: "generatedJson" }, { id: "edl", label: "EDL", kind: "look", from: "generatedEdl" }],
  },
}

describe("a worker unit's JSON (look) outputs", () => {
  it("isUnitJsonWorker: a worker with look outputs — never a media worker, never a use case", () => {
    expect(isUnitJsonWorker(MAP)).toBe(true)
    expect(isUnitJsonWorker(FIXTURE)).toBe(false)
    expect(isUnitJsonWorker({ ...MAP, execution: { kind: "use-case" } } as unknown as UnitDescriptor)).toBe(false)
  })
  it("unitSavedOutput: each look output's field, as the JSON string a wire carries, on unitOutputs; the primary's value on json", () => {
    expect(unitSavedOutput(MAP, { generatedJson: { a: 1 }, generatedEdl: '{"b":2}' })).toEqual({ unitOutputs: { json: '{"a":1}', edl: '{"b":2}' }, json: { a: 1 } })
    expect(unitSavedOutput(MAP, { generatedJson: '{"a":1}' })).toEqual({ unitOutputs: { json: '{"a":1}' }, json: { a: 1 } })
    expect(unitSavedOutput(MAP, { generatedEdl: { b: 2 } })).toEqual({ unitOutputs: { edl: '{"b":2}' } })
    expect(unitSavedOutput(MAP, { generatedJson: "", generatedEdl: null })).toBeUndefined()
    expect(unitSavedOutput(MAP, {})).toBeUndefined()
  })
  it("unitJobOutput: output_data[<output id>] per look output; keys naming no output are dropped; nothing → {}", () => {
    expect(unitJobOutput(MAP, { json: { a: 1 }, edl: { b: 2 }, videoUrl: "x" })).toEqual({ unitOutputs: { json: '{"a":1}', edl: '{"b":2}' }, json: { a: 1 } })
    expect(unitJobOutput(MAP, { edl: { b: 2 } })).toEqual({ unitOutputs: { edl: '{"b":2}' } })
    expect(unitJobOutput(MAP, { videoUrl: "x" })).toEqual({})
  })
  it("unitLookPipOf / unitPipValue: the look pip a wire reads (the one named, else the first), from unitOutputs", () => {
    const output = { unitOutputs: { json: '{"a":1}', edl: '{"b":2}' } }
    expect(unitLookPipOf(MAP, "edl")).toBe("edl")
    expect(unitLookPipOf(MAP, null)).toBe("json")
    expect(unitLookPipOf(MAP, "nope")).toBe("json")
    expect(unitLookPipOf(FIXTURE, "video-out")).toBeUndefined()
    expect(unitLookPipOf(FIXTURE, null)).toBeUndefined()
    expect(unitPipValue(MAP, output, "edl")).toBe('{"b":2}')
    expect(unitPipValue(MAP, output, undefined)).toBe('{"a":1}')
    expect(unitPipValue(MAP, {}, "edl")).toBeUndefined()
    expect(unitPipValue(FIXTURE, output, "video-out")).toBeUndefined()
  })
  it("unitPipJson: the wired look pip's JSON value; undefined when it holds none or is not a look pip", () => {
    const output = { unitOutputs: { json: '{"a":1}', edl: '{"b":2}' } }
    expect(unitPipJson(MAP, output, "edl")).toEqual({ b: 2 })
    expect(unitPipJson(MAP, { unitOutputs: { edl: '{"b":2}' } }, "json")).toBeUndefined()
    expect(unitPipJson(FIXTURE, output, "video-out")).toBeUndefined()
  })
})

// A media unit with side outputs (decided 2026-11-11): an image take, a list of
// images beside it and a JSON output — the shape of tools/units/__fixtures__/unit-list-outputs.json.
const LAYERS: UnitDescriptor = {
  ...FIXTURE,
  type: "fixture-layers",
  outputType: "image",
  producer: "image",
  outputs: ["base", "layers", "layerData"],
  handles: {
    inputs: [],
    outputs: [
      { id: "base", label: "Base", kind: "image", from: "generatedImageUrl" },
      { id: "layers", label: "Layers", kind: "image", from: "generatedLayerUrls", list: true },
      { id: "layerData", label: "Layer data", kind: "look", from: "generatedLayerData" },
    ],
  },
}

describe("a media unit's side outputs (list and JSON beside the take)", () => {
  it("unitHasSideOutputs / isUnitJsonWorker: a plain media take first with a list or look output beside it; a JSON-only worker is not one", () => {
    expect(unitHasSideOutputs(LAYERS)).toBe(true)
    expect(isUnitJsonWorker(LAYERS)).toBe(false)
    expect(unitHasSideOutputs(MAP)).toBe(false)
    expect(unitHasSideOutputs(FIXTURE)).toBe(false)
    expect(unitHasSideOutputs({ ...LAYERS, execution: { kind: "use-case" } } as unknown as UnitDescriptor)).toBe(false)
  })
  it("unitListItems: the non-empty strings of an array, in order; an empty list is no value", () => {
    expect(unitListItems(["a", "", null, 3, "b"])).toEqual(["a", "b"])
    expect(unitListItems([])).toBeUndefined()
    expect(unitListItems(["", null])).toBeUndefined()
    expect(unitListItems("a")).toBeUndefined()
  })
  it("unitJobOutput: each list output's files on unitLists and each look output's string on unitOutputs — never json", () => {
    expect(unitJobOutput(LAYERS, { imageUrl: "b", layers: ["l1", "", "l2"], layerData: [{ n: 1 }], frames: ["f"] })).toEqual({
      unitLists: { layers: ["l1", "l2"] },
      unitOutputs: { layerData: '[{"n":1}]' },
    })
    // An empty list is no value; an empty JSON list is one.
    expect(unitJobOutput(LAYERS, { imageUrl: "b", layers: [], layerData: [] })).toEqual({ unitOutputs: { layerData: "[]" } })
    expect(unitJobOutput(LAYERS, { imageUrl: "b" })).toEqual({})
    // A JSON-only worker keeps its json (its first output's value).
    expect(unitJobOutput(MAP, { json: { a: 1 } })).toEqual({ unitOutputs: { json: '{"a":1}' }, json: { a: 1 } })
  })
  it("unitJobOutput: a list output's `<id>NotSaved` (a whole number, 0 included) on unitListsNotSaved; anything else is no value", () => {
    expect(unitJobOutput(LAYERS, { imageUrl: "b", layers: ["l1"], layersNotSaved: 2 })).toEqual({ unitLists: { layers: ["l1"] }, unitListsNotSaved: { layers: 2 } })
    expect(unitJobOutput(LAYERS, { imageUrl: "b", layers: ["l1"], layersNotSaved: 0 })).toEqual({ unitLists: { layers: ["l1"] }, unitListsNotSaved: { layers: 0 } })
    for (const bad of [-1, 1.5, "2", null]) {
      expect(unitJobOutput(LAYERS, { imageUrl: "b", layersNotSaved: bad }), String(bad)).toEqual({})
    }
    // Only a list output reports one: a look output's or the take's `<id>NotSaved` is not read.
    expect(unitJobOutput(LAYERS, { imageUrl: "b", layerDataNotSaved: 1, baseNotSaved: 1 })).toEqual({})
  })
  it("unitSavedOutput: the take from the active result, side outputs from the active take's own fields when it carries them, else the node's", () => {
    const node = { generatedImageUrl: "new", generatedLayerUrls: ["n1", "n2"], generatedLayerData: [{ n: "new" }] }
    expect(unitSavedOutput(LAYERS, node)).toEqual({ imageUrl: "new", unitLists: { layers: ["n1", "n2"] }, unitOutputs: { layerData: '[{"n":"new"}]' } })
    const older = {
      ...node,
      activeResultIndex: 1,
      generatedResults: [
        { url: "new", generatedLayerUrls: ["n1", "n2"], generatedLayerData: [{ n: "new" }] },
        { url: "old", generatedLayerUrls: ["o1"], generatedLayerData: [{ n: "old" }] },
      ],
    }
    expect(unitSavedOutput(LAYERS, older)).toEqual({ imageUrl: "old", unitLists: { layers: ["o1"] }, unitOutputs: { layerData: '[{"n":"old"}]' } })
    // A take made before it carried side outputs: the node's own fields.
    expect(unitSavedOutput(LAYERS, { ...node, activeResultIndex: 0, generatedResults: [{ url: "new" }] })).toEqual({
      imageUrl: "new", unitLists: { layers: ["n1", "n2"] }, unitOutputs: { layerData: '[{"n":"new"}]' },
    })
    // A take that carries an EMPTY list holds no layers — never the node's.
    expect(unitSavedOutput(LAYERS, { ...node, generatedResults: [{ url: "new", generatedLayerUrls: [] }] })).toEqual({ imageUrl: "new", unitOutputs: { layerData: '[{"n":"new"}]' } })
    // A list never feeds imageUrl, even with no take.
    expect(unitSavedOutput(LAYERS, { generatedLayerUrls: ["l1"] })).toEqual({ unitLists: { layers: ["l1"] } })
  })
  it("a JSON-only worker's saved JSON reads the node's fields, never a take's", () => {
    expect(unitSavedOutput(MAP, { generatedJson: { a: 1 }, generatedResults: [{ url: "x", generatedJson: { a: 2 } }] })).toEqual({ unitOutputs: { json: '{"a":1}' }, json: { a: 1 } })
  })
  it("unitListPipOf / unitListPipItems / unitPipValue: a list pip only when named; a plain wire carries its first file, nothing when it holds none", () => {
    const output = { unitLists: { layers: ["l1", "l2"] }, unitOutputs: { layerData: "[]" } }
    expect(unitListPipOf(LAYERS, "layers")).toBe("layers")
    expect(unitListPipOf(LAYERS, null)).toBeUndefined()
    expect(unitListPipOf(LAYERS, "base")).toBeUndefined()
    expect(unitListPipOf(LAYERS, "nope")).toBeUndefined()
    expect(unitListPipItems(LAYERS, output, "layers")).toEqual(["l1", "l2"])
    expect(unitListPipItems(LAYERS, {}, "layers")).toBeUndefined()
    expect(unitPipValue(LAYERS, output, "layers")).toBe("l1")
    expect(unitPipValue(LAYERS, {}, "layers")).toBeUndefined()
    expect(unitPipValue(LAYERS, output, "layerData")).toBe("[]")
    // The take's pips take the generic media reads.
    expect(unitPipValue(LAYERS, output, "base")).toBeUndefined()
    expect(unitPipValue(LAYERS, output, null)).toBeUndefined()
    // A JSON consumer never reads a list pip as JSON.
    expect(unitPipJson(LAYERS, output, "layers")).toBeUndefined()
  })
  it("unitTakePipOf: the media take of a unit with side outputs (named, unnamed or unknown) — never a side pip, never another unit's take", () => {
    expect(unitTakePipOf(LAYERS, "base")).toBe(true)
    expect(unitTakePipOf(LAYERS, null)).toBe(true)
    expect(unitTakePipOf(LAYERS, "nope")).toBe(true)
    expect(unitTakePipOf(LAYERS, "layers")).toBe(false)
    expect(unitTakePipOf(LAYERS, "layerData")).toBe(false)
    // A unit whose take carries nothing beside it keeps every existing read.
    expect(unitTakePipOf(FIXTURE, "video-out")).toBe(false)
    expect(unitTakePipOf(MAP, null)).toBe(false)
  })
  it("unitPipKindOf: the kind of the pip a wire leaves (the first output when it names none); none for a use case or a run-time-typed pip", () => {
    expect(unitPipKindOf(LAYERS, "layers")).toBe("image")
    expect(unitPipKindOf(LAYERS, null)).toBe("image")
    expect(unitPipKindOf(LAYERS, "layerData")).toBe("look")
    expect(unitPipKindOf(FIXTURE, "video-out")).toBe("video")
    expect(unitPipKindOf({ ...LAYERS, execution: { kind: "use-case" } } as unknown as UnitDescriptor, "base")).toBeUndefined()
    const dynamic = { ...LAYERS, handles: { inputs: [], outputs: [{ id: "media", label: "Media", kind: "image" as const, runtimeTyped: true as const }] } }
    expect(unitPipKindOf(dynamic, "media")).toBeUndefined()
  })
})

describe("a node type that is an Object.prototype member never reaches a unit lookup", () => {
  const KEYS = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]
  it("every keyed aggregate is null-prototype", async () => {
    const aggregates = {
      ...(await import("../../nodes/_generated/registry.js")),
      ...(await import("../../nodes/_generated/routes.js")),
      ...(await import("../../nodes/_generated/engine.js")),
      ...(await import("../../nodes/_generated/workers.js")),
      ...(await import("../../ee/nodes/_generated/prices.js")),
      ...(await import("../../ee/nodes/_generated/routes.js")),
    } as Record<string, Readonly<Record<string, unknown>>>
    expect(Object.keys(aggregates).sort()).toEqual(["UNIT_EE_ROUTES", "UNIT_PAYLOADS", "UNIT_PRICES", "UNIT_REGISTRY", "UNIT_ROUTES", "UNIT_WORKERS"])
    for (const [name, agg] of Object.entries(aggregates)) for (const k of KEYS) expect(agg[k], `${name}[${k}]`).toBeUndefined()
  })
})

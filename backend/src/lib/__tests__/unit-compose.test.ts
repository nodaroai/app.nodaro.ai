// @test-units-by-name composes only the in-memory fixture unit it declares, and looks the aggregates up by prototype keys only
import { describe, expect, it } from "vitest"
import type { UnitDescriptor, UnitPrice } from "../../nodes/kit.js"
import { composeRecord, composeRecordSorted, composeSet, isUnitJsonWorker, placeAfter, registryCategoryOf, unitJobOutput, unitLookPipOf, unitPipJson, unitPipValue, unitRecord, unitSavedOutput, unitStaticCosts, unitsWith } from "../unit-compose.js"

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

import { describe, it, expect } from "vitest"
import { UNIT_BATCH_ROW_KEY, unitBatchSideOutputs } from "@nodaro/render-rules"

/**
 * What a node unit's side outputs hand on after it ran once per upstream item
 * (decided 2026-11-11, row-aligned): the one rule the server's fan-out output
 * and the editor's canvas run apply. Both engines are held to it end to end by
 * tools/units/__fixtures__/unit-list-outputs.json (`batches`); these are its
 * edges.
 */
const OUTPUTS = [
  { id: "base", kind: "image" },
  { id: "layers", kind: "image", list: true },
  { id: "layerData", kind: "look", alignedWith: "layers" },
] as const

describe("unitBatchSideOutputs", () => {
  it("each list output's files row by row; the aligned JSON's entries row by row, each with its row; the counts summed", () => {
    const whole = unitBatchSideOutputs(OUTPUTS, [
      { unitLists: { layers: ["a1", "a2"] }, unitOutputs: { layerData: '[{"n":"a1"},{"n":"a2"}]' }, unitListsNotSaved: { layers: 1 } },
      { unitOutputs: { layerData: "[]" }, unitListsNotSaved: { layers: 0 } },
      { unitLists: { layers: ["c1"] }, unitOutputs: { layerData: [{ n: "c1" }] }, unitListsNotSaved: { layers: 2 } },
    ])
    expect(whole).toEqual({
      unitLists: { layers: ["a1", "a2", "c1"] },
      unitOutputs: { layerData: JSON.stringify([{ n: "a1", row: 0 }, { n: "a2", row: 0 }, { n: "c1", row: 2 }]) },
      unitListsNotSaved: { layers: 3 },
    })
    expect(UNIT_BATCH_ROW_KEY).toBe("row")
  })

  it("a failed row (null) and a row with none add nothing; the row index is never a position", () => {
    const whole = unitBatchSideOutputs(OUTPUTS, [null, undefined, { unitLists: { layers: ["c1"] }, unitOutputs: { layerData: '[{"n":"c1"}]' } }])
    expect(whole).toEqual({ unitLists: { layers: ["c1"] }, unitOutputs: { layerData: '[{"n":"c1","row":2}]' } })
  })

  it("no row made a value: the key is absent; rows that made only empty JSON lists: \"[]\" (an empty JSON list is a value)", () => {
    expect(unitBatchSideOutputs(OUTPUTS, [null, {}])).toEqual({})
    expect(unitBatchSideOutputs(OUTPUTS, [{ unitOutputs: { layerData: "[]" } }, { unitOutputs: { layerData: [] } }])).toEqual({ unitOutputs: { layerData: "[]" } })
  })

  it("list items that are not files are dropped; a count that is not a whole number from 0 is no count", () => {
    const whole = unitBatchSideOutputs(OUTPUTS, [
      { unitLists: { layers: ["a1", "", null, 3] }, unitListsNotSaved: { layers: -1 } },
      { unitLists: { layers: "a2" }, unitListsNotSaved: { layers: "2" } },
    ])
    expect(whole).toEqual({ unitLists: { layers: ["a1"] } })
  })

  it("the row wins over a `row` an entry carried; an entry that is not an object becomes { value, row }; an object value is one entry", () => {
    const whole = unitBatchSideOutputs(OUTPUTS, [
      { unitOutputs: { layerData: '[{"n":"a","row":9},"plain",null]' } },
      { unitOutputs: { layerData: '{"n":"b"}' } },
      { unitOutputs: { layerData: "not json" } },
    ])
    expect(JSON.parse(whole.unitOutputs!.layerData!)).toEqual([
      { n: "a", row: 0 },
      { value: "plain", row: 0 },
      { n: "b", row: 1 },
      { value: "not json", row: 2 },
    ])
  })

  it("a JSON output aligned with no list output keeps the first row's value that has one, as stored", () => {
    const outputs = [{ id: "base", kind: "image" }, { id: "summary", kind: "look" }, { id: "odd", kind: "look", alignedWith: "nope" }] as const
    expect(unitBatchSideOutputs(outputs, [null, { unitOutputs: { summary: '{"k":1}', odd: [1] } }, { unitOutputs: { summary: '{"k":2}' } }]))
      .toEqual({ unitOutputs: { summary: '{"k":1}', odd: "[1]" } })
  })
})

/**
 * The use-case rows (each node's builder key, label and inputs) and the
 * builder-keyed specs compose the descriptors: one row per use-case type, in
 * USE_CASE_NODE_TYPES order; every spec used by some node (a builder no node
 * names is dead); an unknown builder throws at call time; a descriptor is
 * reviewable exactly when @nodaro/shared's review holds name its type; and the
 * composition refuses two rows for one type, one builder for two types, and
 * rows that disagree with the type list. And a use-case node lists its result
 * exactly when @nodaro/shared's FAN_OUT_EACH_HANDLES has its row (its
 * contract.fanOutEach), whose each pips are its media outputs — shared cannot
 * read the descriptors, so this test ties the two.
 */
import { describe, expect, it } from "vitest"
import { FAN_OUT_EACH_HANDLES, REVIEW_HOLDING_USE_CASE_TYPES, USE_CASE_NODE_TYPES } from "@nodaro/shared/nodes"
import { USE_CASE_ROWS, USE_CASE_SPECS, composeUseCaseRows, usecaseDescriptor, usecaseListsItsResult, usecaseRowOf, usecaseTypeOfBuilder, type UseCaseRow } from "@nodaro/render-rules"
import { unitDescriptorOf } from "../unit-descriptors.js"

describe("the use-case rows", () => {
  it("are one row per use-case type, in USE_CASE_NODE_TYPES order", () => {
    expect(USE_CASE_ROWS.map((r) => r.type)).toEqual([...USE_CASE_NODE_TYPES])
  })

  it("name every builder spec — a builder no node uses is dead", () => {
    const used = new Set(USE_CASE_ROWS.map((r) => r.builder))
    expect(Object.keys(USE_CASE_SPECS).filter((key) => !used.has(key))).toEqual([])
  })

  it("name each builder once, and only builders that have a spec", () => {
    const builders = USE_CASE_ROWS.map((r) => r.builder)
    expect(new Set(builders).size).toBe(builders.length)
    for (const b of builders) expect(Object.keys(USE_CASE_SPECS), b).toContain(b)
  })

  it("find a type by its builder, and throw for a builder no node declares", () => {
    for (const row of USE_CASE_ROWS) {
      expect(usecaseTypeOfBuilder(row.builder)).toBe(row.type)
      expect(usecaseRowOf(row.type)).toBe(row)
    }
    expect(() => usecaseTypeOfBuilder("nope")).toThrow(/no use-case node declares builder "nope"/)
  })

  it("give each descriptor its row's label and inputs, and reviewable = the review holds", () => {
    for (const row of USE_CASE_ROWS) {
      const d = usecaseDescriptor(row.type)
      expect(d.label).toBe(row.label)
      expect(d.inputs).toEqual(row.inputs)
      expect(d.reviewable, row.type).toBe(REVIEW_HOLDING_USE_CASE_TYPES.has(row.type))
    }
  })
})

describe("composeUseCaseRows", () => {
  const row = (type: string, builder: string): UseCaseRow => ({ type, builder, label: type, inputs: ["media"] }) as unknown as UseCaseRow
  const units = [row("episode-chapters", "chapters"), row("tighten-episode", "tighten")]

  it("lists the rows in the type list's order", () => {
    const rows = composeUseCaseRows([...units, row("fixture-case", "fixture")], ["tighten-episode", "episode-chapters", "fixture-case"])
    expect(rows.map((r) => r.type)).toEqual(["tighten-episode", "episode-chapters", "fixture-case"])
  })

  it("refuses a builder named by two nodes — so a builder finds exactly one type", () => {
    expect(() => composeUseCaseRows([...units, row("fixture-case", "tighten")], ["tighten-episode", "episode-chapters", "fixture-case"]))
      .toThrow("use-case rows: a builder is named by more than one node — one use-case spec builds one node type")
  })

  it("refuses a type with two rows", () => {
    expect(() => composeUseCaseRows([...units, row("episode-chapters", "fixture")], ["tighten-episode", "episode-chapters"]))
      .toThrow(/use-case rows: a type has more than one row — a type lives in one place/)
  })

  it("refuses rows that disagree with the type list", () => {
    expect(() => composeUseCaseRows(units, ["tighten-episode"])).toThrow(/missing none, extra episode-chapters/)
    expect(() => composeUseCaseRows(units, ["tighten-episode", "episode-chapters", "fixture-case"])).toThrow(/missing fixture-case, extra none/)
  })
})

type FanOutRow = { readonly each: readonly string[]; readonly primary: string }

/**
 * Each use-case type whose list result and FAN_OUT_EACH_HANDLES row disagree:
 * a node that lists its result needs a row (or an edge after it never reads
 * the list item by item), a row on any other node fans out a single value, and
 * a list's each pips are exactly its media outputs.
 */
function fanOutEachProblems(
  types: readonly string[],
  listsResult: (t: string) => boolean,
  table: Readonly<Record<string, FanOutRow>>,
  mediaOutputsOf: (t: string) => readonly string[] | undefined,
): string[] {
  const out: string[] = []
  for (const t of types) {
    const row = Object.hasOwn(table, t) ? table[t] : undefined
    if (listsResult(t) && !row) out.push(`${t}: lists its result but has no FAN_OUT_EACH_HANDLES row — declare contract.fanOutEach in its unit.json`)
    else if (!listsResult(t) && row) out.push(`${t}: has a FAN_OUT_EACH_HANDLES row but its result is not a list — remove contract.fanOutEach`)
    else if (row) {
      const media = mediaOutputsOf(t)
      if (!media) out.push(`${t}: is not a node unit, so its outputs are unknown`)
      else if ([...row.each].sort().join() !== [...media].sort().join()) out.push(`${t}: contract.fanOutEach.each is [${row.each.join(", ")}], its media outputs are [${media.join(", ")}]`)
    }
  }
  return out
}

const MEDIA_KINDS: readonly string[] = ["audio", "video", "image"]
const mediaOutputsOf = (t: string): readonly string[] | undefined =>
  unitDescriptorOf(t)?.handles.outputs.filter((h) => MEDIA_KINDS.includes(h.kind)).map((h) => h.id)

describe("a use-case node's list result and its FAN_OUT_EACH_HANDLES row", () => {
  it("agree for every use-case type", () => {
    expect(fanOutEachProblems(USE_CASE_NODE_TYPES, usecaseListsItsResult, FAN_OUT_EACH_HANDLES, mediaOutputsOf)).toEqual([])
  })

  it("the check fails a list node that forgets its row, a row on a node that lists nothing, and each pips that are not its media outputs", () => {
    const lists = (t: string) => t.startsWith("list-")
    const media = (t: string) => (t === "list-plain" ? undefined : ["media"])
    const table = { "list-wrong": { each: ["json"], primary: "json" }, "single-row": { each: ["media"], primary: "media" }, "list-ok": { each: ["media"], primary: "media" }, "list-plain": { each: ["media"], primary: "media" } }
    expect(fanOutEachProblems(["list-forgot", "list-wrong", "single-row", "list-ok", "list-plain", "single-none"], lists, table, media)).toEqual([
      "list-forgot: lists its result but has no FAN_OUT_EACH_HANDLES row — declare contract.fanOutEach in its unit.json",
      "list-wrong: contract.fanOutEach.each is [json], its media outputs are [media]",
      "single-row: has a FAN_OUT_EACH_HANDLES row but its result is not a list — remove contract.fanOutEach",
      "list-plain: is not a node unit, so its outputs are unknown",
    ])
  })
})

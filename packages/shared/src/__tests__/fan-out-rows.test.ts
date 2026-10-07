import { describe, it, expect } from "vitest"
import {
  NON_PROMPT_TEXT_LANES,
  fanOutTextFeedsPrompt,
  compactWithRows,
  resolveListFanOut,
  planFanOut,
  alignedFieldList,
  liveRowColumn,
  pickHeldRow,
  type FanOutCandidate,
} from "../fan-out-rows.js"
import { REPEAT_PLACEHOLDER, encodeProviderItem } from "../repeat-types.js"

describe("fanOutTextFeedsPrompt", () => {
  it("a list wired to the prompt (or to a node's single generic input) feeds the prompt", () => {
    expect(fanOutTextFeedsPrompt("generate-image", "prompt")).toBe(true)
    expect(fanOutTextFeedsPrompt("text-to-speech", "in")).toBe(true)
    expect(fanOutTextFeedsPrompt("generate-image", undefined)).toBe(true)
    expect(fanOutTextFeedsPrompt(undefined, null)).toBe(true)
  })

  it("a list wired to a lane the routers divert does NOT feed the prompt", () => {
    expect(fanOutTextFeedsPrompt("generate-image", "negative")).toBe(false)
    expect(fanOutTextFeedsPrompt("llm-chat", "system-prompt")).toBe(false)
    expect(fanOutTextFeedsPrompt("ai-avatar", "script")).toBe(false)
  })

  it("is scoped by node type: the same handle can be the prompt elsewhere", () => {
    expect(fanOutTextFeedsPrompt("add-captions", "transcript")).toBe(false)
    expect(fanOutTextFeedsPrompt("forced-alignment", "transcript")).toBe(true)
  })

  it("a '*' lane covers every node type, including ones that do not exist yet", () => {
    expect(NON_PROMPT_TEXT_LANES.negative).toBe("*")
    expect(fanOutTextFeedsPrompt("some-future-node", "negative")).toBe(false)
  })

  it("a handle named like an Object.prototype member is just an unlisted handle", () => {
    expect(fanOutTextFeedsPrompt("generate-image", "constructor")).toBe(true)
    expect(fanOutTextFeedsPrompt("generate-image", "toString")).toBe(true)
  })
})

describe("compactWithRows", () => {
  it("drops empty cells but remembers the row each kept value came from", () => {
    expect(compactWithRows(["a", "", "  ", "d"])).toEqual({ items: ["a", "d"], rowIndices: [0, 3] })
  })

  it("is the identity (with 0..n-1 rows) for a list with no holes", () => {
    expect(compactWithRows(["a", "b"])).toEqual({ items: ["a", "b"], rowIndices: [0, 1] })
  })

  it("keeps the ORIGINAL text of a kept value (no trimming of content)", () => {
    expect(compactWithRows([" a ", "b\nc"]).items).toEqual([" a ", "b\nc"])
  })
})

describe("liveRowColumn", () => {
  it("drops a row only when EVERY cell of it is blank, and keeps an empty cell of a live row in place", () => {
    const rows = [["a", "x"], ["b", ""], ["", ""], ["", "z"]]
    expect(liveRowColumn(rows, 0)).toEqual(["a", "b", ""])
    expect(liveRowColumn(rows, 1)).toEqual(["x", "", "z"])
  })

  it("a single-column list with a trailing blank row does not grow", () => {
    expect(liveRowColumn([["a"], ["b"], [""]], 0)).toEqual(["a", "b"])
  })

  it("trims cells and tolerates ragged rows", () => {
    expect(liveRowColumn([[" a "], ["b", "y"]], 1)).toEqual(["", "y"])
  })
})

describe("resolveListFanOut", () => {
  const cand = (targetHandle: string, aligned: string[]): FanOutCandidate => ({ targetHandle, aligned })

  it("a single list: its values drive, on the rows they sit in", () => {
    const only = cand("prompt", ["p1", "", "p3"])
    expect(resolveListFanOut([only], "generate-image")).toEqual({ items: ["p1", "p3"], rowIndices: [0, 2], targetHandle: "prompt" })
  })

  it("the list that feeds the prompt drives — whichever wire the engine met first", () => {
    const negative = cand("negative", ["n1", "n2", "n3"])
    const prompt = cand("prompt", ["p1", "p2", "p3"])
    const expected = { items: ["p1", "p2", "p3"], rowIndices: [0, 1, 2], targetHandle: "prompt" }
    expect(resolveListFanOut([negative, prompt], "generate-image")).toEqual(expected)
    expect(resolveListFanOut([prompt, negative], "generate-image")).toEqual(expected)
  })

  it("a list wired to negative ALONE drives through negative (so nothing writes it into the prompt)", () => {
    const negative = cand("negative", ["n1", "n2"])
    expect(resolveListFanOut([negative], "generate-image")?.targetHandle).toBe("negative")
  })

  it("a row runs when ANY column has a value in it; an empty driver cell overrides nothing", () => {
    const negative = cand("negative", ["n1", "n2", "n3"])
    const prompt = cand("prompt", ["p1", "", "p3"])
    const expected = { items: ["p1", "", "p3"], rowIndices: [0, 1, 2], targetHandle: "prompt" }
    expect(resolveListFanOut([negative, prompt], "generate-image")).toEqual(expected)
    expect(resolveListFanOut([prompt, negative], "generate-image")).toEqual(expected)
  })

  it("a row that is empty in EVERY column does not run", () => {
    const negative = cand("negative", ["n1", "", "n3"])
    const prompt = cand("prompt", ["p1", "", "p3"])
    expect(resolveListFanOut([prompt, negative], "generate-image")?.rowIndices).toEqual([0, 2])
  })

  it("the list holding the MOST values sets the rows — in either wire order — and one of another length stays out of it", () => {
    const negative = cand("negative", ["n1", "n2", "n3"])
    const prompt = cand("prompt", ["p1", "p2"])
    const expected = { items: ["n1", "n2", "n3"], rowIndices: [0, 1, 2], targetHandle: "negative" }
    expect(resolveListFanOut([negative, prompt], "generate-image")).toEqual(expected)
    expect(resolveListFanOut([prompt, negative], "generate-image")).toEqual(expected)
  })

  it("values held decide the primary, not the row count (a long column that is mostly empty does not win)", () => {
    const sparse = cand("negative", ["n1", "", "", "", "n5"])
    const prompts = cand("prompt", ["p1", "p2", "p3"])
    expect(resolveListFanOut([sparse, prompts], "generate-image")).toEqual({
      items: ["p1", "p2", "p3"],
      rowIndices: [0, 1, 2],
      targetHandle: "prompt",
    })
  })

  it("no candidates, no fan-out", () => {
    expect(resolveListFanOut([], "generate-image")).toBeUndefined()
  })

  it("a media list never supplies the prompt: beside images, the prompts drive and every image row still runs", () => {
    const images = cand("image", ["https://cdn/a.png", "https://cdn/b.png", "https://cdn/c.png"])
    const prompts = cand("prompt", ["p1", "", "p3"])
    const expected = { items: ["p1", "", "p3"], rowIndices: [0, 1, 2], targetHandle: "prompt" }
    expect(resolveListFanOut([images, prompts], "image-to-video")).toEqual(expected)
    expect(resolveListFanOut([prompts, images], "image-to-video")).toEqual(expected)
  })
})

describe("planFanOut", () => {
  const fanOut = { items: ["a", "c"], rowIndices: [0, 2], targetHandle: "prompt" }

  it("maps every iteration to the row its item came from", () => {
    expect(planFanOut(fanOut, "generate-image", {})).toEqual({
      items: ["a", "c"],
      rows: [0, 2],
      targetHandle: "prompt",
    })
  })

  it("repeat xN keeps each repeated iteration on ITS OWN row (the sibling columns stay paired)", () => {
    expect(planFanOut(fanOut, "generate-image", { repeatCount: 2 })).toEqual({
      items: ["a", "a", "c", "c"],
      rows: [0, 0, 2, 2],
      targetHandle: "prompt",
    })
  })

  it("repeat-only and provider-only runs have no rows (nothing is list-driven)", () => {
    expect(planFanOut(undefined, "generate-image", { repeatCount: 3 })).toEqual({
      items: [REPEAT_PLACEHOLDER, REPEAT_PLACEHOLDER, REPEAT_PLACEHOLDER],
      rows: [undefined, undefined, undefined],
      targetHandle: undefined,
    })
    expect(planFanOut(undefined, "generate-image", { providers: ["a", "b"] })?.items).toEqual([
      encodeProviderItem("a"),
      encodeProviderItem("b"),
    ])
  })

  it("returns null when there is nothing to fan out (single run)", () => {
    expect(planFanOut(undefined, "generate-image", {})).toBeNull()
    expect(planFanOut({ items: ["only"], rowIndices: [0], targetHandle: "prompt" }, "generate-image", {})).toBeNull()
  })
})

describe("alignedFieldList", () => {
  const concepts = [
    { prompt: "p1", negative: "n1" },
    { prompt: "p2", negative: "" },
    { prompt: "p3", negative: "n3" },
    { prompt: "p4" },
    { prompt: "p5", negative: null },
  ]

  it("emits one entry per element of a root array, empty where the element has no value", () => {
    expect(alignedFieldList(concepts, "negative")).toEqual(["n1", "", "n3", "", ""])
    expect(alignedFieldList(concepts, "prompt")).toEqual(["p1", "p2", "p3", "p4", "p5"])
  })

  it("stringifies like Extract Field does (numbers, booleans, objects)", () => {
    expect(alignedFieldList([{ v: 1 }, { v: false }, { v: { a: 1 } }], "v")).toEqual(["1", "false", '{"a":1}'])
  })

  it("supports nested dot paths and whole-item mode", () => {
    expect(alignedFieldList([{ a: { b: "x" } }, { a: {} }], "a.b")).toEqual(["x", ""])
    expect(alignedFieldList(["a", "b"], "")).toEqual(["a", "b"])
  })

  it("has no answer when rows cannot be defined — not a root array, or an element fans into several values", () => {
    expect(alignedFieldList({ prompt: "p" }, "prompt")).toBeUndefined()
    expect(alignedFieldList([{ pages: [{ url: "u1" }, { url: "u2" }] }], "pages.url")).toBeUndefined()
  })

  it("has no answer when NO element carries the field (an all-blank list is not a list)", () => {
    expect(alignedFieldList([{ a: 1 }, { b: 2 }], "missing")).toBeUndefined()
  })
})

describe("pickHeldRow — one value off a list with holes, outside its fan-out", () => {
  // An Edit Plan's clips as a person's review leaves them: the PLAN's rows,
  // "" at every dropped clip. Clips 1 and 4 are kept.
  const rows = ["c1", "", "", "c4"]

  it("a selector that leaves one kept clip reads that clip, never the plan's first kept one", () => {
    expect(pickHeldRow(rows, { selectorMode: "list", listExpression: "2,4" }, false)).toEqual({ kind: "value", value: "c4" })
    expect(pickHeldRow(rows, { outputMode: "each", rangeFrom: "3", rangeTo: "last" }, false)).toEqual({ kind: "value", value: "c4" })
  })

  it("a selector that leaves no kept clip reads nothing", () => {
    expect(pickHeldRow(rows, { selectorMode: "list", listExpression: "2,3" }, false)).toEqual({ kind: "none" })
  })

  it("a selector that leaves several reads the first kept clip OF THE SELECTION", () => {
    expect(pickHeldRow(["", "c2", "c3", "c4"], { selectorMode: "list", listExpression: "4,3" }, false)).toEqual({ kind: "value", value: "c4" })
  })

  it("an item pick on a dropped clip reads nothing; on a kept clip, that clip", () => {
    expect(pickHeldRow(rows, { outputMode: "item", itemIndex: "2" }, false)).toEqual({ kind: "none" })
    expect(pickHeldRow(rows, { outputMode: "item", itemIndex: "last" }, false)).toEqual({ kind: "value", value: "c4" })
    expect(pickHeldRow(rows, { outputMode: "item:1" }, false)).toEqual({ kind: "none" })
    expect(pickHeldRow(rows, { outputMode: "item:0" }, true)).toEqual({ kind: "value", value: "c1" })
  })

  it("leaves every other read alone: a default each edge, Selected, Bundle, and an each edge inside its fan-out", () => {
    expect(pickHeldRow(rows, undefined, false)).toEqual({ kind: "unaffected" })
    expect(pickHeldRow(rows, { outputMode: "each" }, false)).toEqual({ kind: "unaffected" })
    expect(pickHeldRow(rows, { outputMode: "last", selectorMode: "list", listExpression: "2" }, false)).toEqual({ kind: "unaffected" })
    expect(pickHeldRow(rows, { outputMode: "all", selectorMode: "list", listExpression: "2" }, false)).toEqual({ kind: "unaffected" })
    expect(pickHeldRow(rows, { selectorMode: "list", listExpression: "2,4" }, true)).toEqual({ kind: "unaffected" })
    expect(pickHeldRow([], { outputMode: "item", itemIndex: "2" }, false)).toEqual({ kind: "unaffected" })
  })
})

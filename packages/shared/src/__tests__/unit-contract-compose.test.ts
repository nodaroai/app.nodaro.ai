import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * The tables that compose the node units' generated rows (unit-contract-compose.ts):
 * the presentation sets, JSON_OUTPUT_KINDS, NON_PROMPT_TEXT_LANES, the review
 * holds, USE_CASE_NODE_TYPES and FAN_OUT_EACH_HANDLES. Each case loads the modules fresh over
 * stand-in rows (the real units' rows left out) — a unit is added after the
 * hand-written entries, and a type that is in both refuses to load. The
 * use-case types and the review holds have no hand-written entries left.
 */

type Rows = {
  UNIT_CONTRACTS?: ReadonlyArray<readonly [string, string]>
  UNIT_USE_CASE_TYPES?: readonly string[]
  UNIT_JSON_PIPS?: ReadonlyArray<readonly [string, Record<string, string>]>
  UNIT_NON_PROMPT_INPUTS?: ReadonlyArray<readonly [string, readonly string[]]>
  UNIT_REVIEW_HOLDS?: readonly string[]
  UNIT_PRESENTS?: ReadonlyArray<readonly [string, string]>
  UNIT_FAN_OUT_EACH?: ReadonlyArray<readonly [string, { each: readonly string[]; primary: string }]>
}

function withRows(rows: Rows): void {
  vi.resetModules()
  vi.doMock("../generated/unit-contracts.js", () => ({
    UNIT_CONTRACTS: [],
    UNIT_USE_CASE_TYPES: [],
    UNIT_JSON_PIPS: [],
    UNIT_NON_PROMPT_INPUTS: [],
    UNIT_REVIEW_HOLDS: [],
    UNIT_PRESENTS: [],
    UNIT_FAN_OUT_EACH: [],
    ...rows,
  }))
}

afterEach(() => {
  vi.doUnmock("../generated/unit-contracts.js")
  vi.resetModules()
})

describe("a node unit's contract rows join the published tables", () => {
  it("each table gains the unit after its hand-written entries", async () => {
    withRows({
      UNIT_USE_CASE_TYPES: ["fixture-case"],
      UNIT_JSON_PIPS: [["fixture-case", { json: "edl" }]],
      UNIT_NON_PROMPT_INPUTS: [["fixture-case", ["music", "media", "negative"]]],
      UNIT_REVIEW_HOLDS: ["fixture-case"],
      UNIT_PRESENTS: [["fixture-case", "text"]],
      UNIT_FAN_OUT_EACH: [["fixture-case", { each: ["media"], primary: "media" }]],
    })
    const { getOutputType } = await import("../presentation-utils.js")
    const { declaredJsonOutput, declaredJsonOutputRows } = await import("../json-kinds.js")
    const { NON_PROMPT_TEXT_LANES, fanOutTextFeedsPrompt } = await import("../fan-out-rows.js")
    const { REVIEW_HOLDING_USE_CASE_TYPES, isPreviewHoldingType } = await import("../preview-gate.js")
    const { USE_CASE_NODE_TYPES, isUseCaseNodeType } = await import("../use-case-types.js")

    expect(getOutputType("fixture-case")).toBe("text")
    expect(getOutputType("apply-edl")).toBe("video")

    expect(declaredJsonOutput("fixture-case", "json")).toBe("edl")
    // A unit has no primary pip: an edge with no sourceHandle reads no JSON.
    expect(declaredJsonOutput("fixture-case", undefined)).toBeUndefined()
    expect(declaredJsonOutputRows().at(-1)).toEqual(["fixture-case", "json", "edl"])

    expect(NON_PROMPT_TEXT_LANES.negative).toBe("*")
    // A handle no list named gets one, after every hand-written key.
    expect(NON_PROMPT_TEXT_LANES.music).toEqual(["fixture-case"])
    expect(NON_PROMPT_TEXT_LANES.media).toEqual(["fixture-case"])
    expect(Object.keys(NON_PROMPT_TEXT_LANES).at(-1)).toBe("media")
    expect(fanOutTextFeedsPrompt("fixture-case", "music")).toBe(false)
    expect(fanOutTextFeedsPrompt("fixture-case", "prompt")).toBe(true)

    expect([...REVIEW_HOLDING_USE_CASE_TYPES]).toEqual(["fixture-case"])
    expect(isPreviewHoldingType("fixture-case")).toBe(true)

    expect([...USE_CASE_NODE_TYPES]).toEqual(["fixture-case"])
    expect(isUseCaseNodeType("fixture-case")).toBe(true)

    const { FAN_OUT_EACH_HANDLES, defaultEdgeOutputMode, listResultsServeHandle } = await import("../producer-types.js")
    expect(Object.keys(FAN_OUT_EACH_HANDLES).at(-1)).toBe("fixture-case")
    expect(FAN_OUT_EACH_HANDLES["camera-switch"]).toEqual({ each: ["edl"], primary: "edl" })
    expect(defaultEdgeOutputMode("fixture-case", "media")).toBe("each")
    expect(defaultEdgeOutputMode("fixture-case", undefined)).toBe("each")
    expect(defaultEdgeOutputMode("fixture-case", "json")).toBe("last")
    expect(listResultsServeHandle("fixture-case", "json")).toBe(false)
  })

  it("with no rows every table is exactly its hand-written entries", async () => {
    withRows({})
    const { FAN_OUT_EACH_HANDLES } = await import("../producer-types.js")
    expect(Object.keys(FAN_OUT_EACH_HANDLES)).toEqual(["camera-switch", "ugc-clips"])
    const { NON_PROMPT_TEXT_LANES } = await import("../fan-out-rows.js")
    const { REVIEW_HOLDING_USE_CASE_TYPES } = await import("../preview-gate.js")
    expect(NON_PROMPT_TEXT_LANES.music).toBeUndefined()
    expect(Object.keys(NON_PROMPT_TEXT_LANES).at(-1)).toBe("link")
    expect([...REVIEW_HOLDING_USE_CASE_TYPES]).toEqual([])
  })
})

describe("a type that is hand-written and a node unit refuses to load", () => {
  const cases: ReadonlyArray<readonly [string, Rows, RegExp]> = [
    ["../presentation-utils.js", { UNIT_PRESENTS: [["upload-image", "image"]] }, /IMAGE_OUTPUT_TYPES: upload-image is both hand-written and a node unit/],
    ["../json-kinds.js", { UNIT_JSON_PIPS: [["transcribe", { json: "transcript" }]] }, /JSON_OUTPUT_KINDS: transcribe is both a legacy entry and a node unit/],
    ["../fan-out-rows.js", { UNIT_NON_PROMPT_INPUTS: [["apply-edl", ["transcript"]]] }, /NON_PROMPT_TEXT_LANES: apply-edl is listed for "transcript" both by hand and as a node unit/],
    ["../use-case-types.js", { UNIT_USE_CASE_TYPES: ["episode-chapters", "episode-chapters"] }, /USE_CASE_NODE_TYPES: .* lists a type twice/],
    ["../producer-types.js", { UNIT_CONTRACTS: [["upload-video", "video"]] }, /VIDEO_PRODUCER_TYPES: upload-video is both hand-written and a node unit/],
    ["../producer-types.js", { UNIT_FAN_OUT_EACH: [["camera-switch", { each: ["edl"], primary: "edl" }]] }, /FAN_OUT_EACH_HANDLES: camera-switch is both hand-written and a node unit/],
  ]
  for (const [mod, rows, message] of cases) {
    it(mod, async () => {
      withRows(rows)
      await expect(import(/* @vite-ignore */ mod)).rejects.toThrow(message)
    })
  }
})

describe("a node unit with two fan-out rows refuses to load", () => {
  it("../producer-types.js", async () => {
    withRows({ UNIT_FAN_OUT_EACH: [["fixture-case", { each: ["media"], primary: "media" }], ["fixture-case", { each: ["json"], primary: "json" }]] })
    await expect(import("../producer-types.js")).rejects.toThrow(/FAN_OUT_EACH_HANDLES: node unit fixture-case has more than one row/)
  })
})

describe("a node unit's own row that names one handle twice refuses to load", () => {
  it("../fan-out-rows.js", async () => {
    withRows({ UNIT_NON_PROMPT_INPUTS: [["fixture-case", ["media", "media"]]] })
    await expect(import("../fan-out-rows.js")).rejects.toThrow(/NON_PROMPT_TEXT_LANES: node unit fixture-case lists "media" twice in its contract\.nonPromptInputs/)
  })
})

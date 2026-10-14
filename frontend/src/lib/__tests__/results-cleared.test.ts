// @vitest-environment node
// The watermark "Clear results" leaves on a node, and the one question the
// load-time recovery lanes ask of it: did this run settle before the clear?
import { describe, it, expect } from "vitest"
import { EXECUTION_DATA_KEYS, TRANSIENT_RUNTIME_KEYS } from "@nodaro/shared"
import { RESULTS_CLEARED_AT_KEY, resultsClearedWatermark, settledBeforeClear } from "../results-cleared"

const CLEARED = "2026-09-20T10:00:00.000Z"
const stamped = { [RESULTS_CLEARED_AT_KEY]: CLEARED }

describe("settledBeforeClear", () => {
  it("is false for a node that was never cleared — recovery behaves as it always has", () => {
    expect(settledBeforeClear({}, "2020-01-01T00:00:00Z")).toBe(false)
    expect(settledBeforeClear(undefined, "2020-01-01T00:00:00Z")).toBe(false)
  })

  it("a run that settled before the clear is one the node was cleared of", () => {
    expect(settledBeforeClear(stamped, "2026-09-20T09:59:59.000Z")).toBe(true)
  })

  it("a run that settled after the clear is new work — recovered as always", () => {
    expect(settledBeforeClear(stamped, "2026-09-20T10:00:00.001Z")).toBe(false)
  })

  it("the same instant counts as before — a tie must not resurrect what was just cleared", () => {
    expect(settledBeforeClear(stamped, CLEARED)).toBe(true)
  })

  it("compares INSTANTS, not strings — the server writes an offset, the stamp writes Z", () => {
    // 12:30+03:00 is 09:30Z: before the clear, though it sorts after it as text.
    expect(settledBeforeClear(stamped, "2026-09-20T12:30:00+03:00")).toBe(true)
    // 08:30-02:00 is 10:30Z: after the clear, though it sorts before it as text.
    expect(settledBeforeClear(stamped, "2026-09-20T08:30:00-02:00")).toBe(false)
  })

  it("a run with no usable time cannot be shown to be newer, so the clear wins", () => {
    expect(settledBeforeClear(stamped, undefined)).toBe(true)
    expect(settledBeforeClear(stamped, null)).toBe(true)
    expect(settledBeforeClear(stamped, "not a date")).toBe(true)
  })

  it("a corrupt stamp is no stamp", () => {
    expect(settledBeforeClear({ [RESULTS_CLEARED_AT_KEY]: "garbage" }, "2020-01-01T00:00:00Z")).toBe(false)
    expect(settledBeforeClear({ [RESULTS_CLEARED_AT_KEY]: 1726826400000 }, "2020-01-01T00:00:00Z")).toBe(false)
  })
})

describe("resultsClearedWatermark", () => {
  const now = Date.parse(CLEARED)

  it("is the time of the clear", () => {
    expect(resultsClearedWatermark(now, null)).toBe(CLEARED)
    expect(resultsClearedWatermark(now, "2026-09-20T09:00:00.000Z")).toBe(CLEARED)
  })

  it("is never earlier than the last save the SERVER acknowledged — a slow device clock cannot date the clear before its own results", () => {
    expect(resultsClearedWatermark(now, "2026-09-20T10:07:00.000Z")).toBe("2026-09-20T10:07:00.001Z")
    expect(resultsClearedWatermark(now, "2026-09-20T13:07:00+03:00")).toBe("2026-09-20T10:07:00.001Z")
  })

  it("ignores a save time it cannot read", () => {
    expect(resultsClearedWatermark(now, "nonsense")).toBe(CLEARED)
  })
})

describe("the key's place in the runtime registry", () => {
  it("is runtime bookkeeping (out of presets, templates, the copilot's view, auto-execute's config hash)…", () => {
    expect(EXECUTION_DATA_KEYS.has(RESULTS_CLEARED_AT_KEY)).toBe(true)
  })

  it("…and is PERSISTED: the next load is exactly when it is read", () => {
    expect(TRANSIENT_RUNTIME_KEYS.has(RESULTS_CLEARED_AT_KEY)).toBe(false)
  })
})

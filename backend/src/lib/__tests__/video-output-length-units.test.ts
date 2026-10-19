/**
 * The "length:unknown" seam (tools/units/capabilities.mjs): a node unit with
 * that capability gets the unbounded length rule the hand-written unbounded
 * nodes (render-video, manual-edit, …) have, and a row in
 * UNBOUNDED_LENGTH_REASONS — composed in video-output-length.ts from the
 * unit descriptors (lib/unit-descriptors.ts).
 *
 * Proven on an in-memory fixture unit, both through the pure helper and
 * through the module's own composition (the descriptors door mocked), and
 * held to zero change by gif-to-video's migration: the live tables are the
 * tables composed with no unit plus gif-to-video's former hand-written row,
 * moved into its unit (same rule behaviour, same reason text).
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import type { UnitDescriptor } from "../../nodes/kit.js"
import type { WireInput, WireLength } from "../video-output-length.js"

type LengthModule = typeof import("../video-output-length.js")

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
  execution: { kind: "worker", queue: "video" },
  capabilities: ["length:unknown"],
  lengthUnknownReason: "its length is the fixture's, which only the file says",
}
/** A unit with another length capability: it reaches the rules through LENGTH_KEEPING_VIDEO_TYPES, never through this seam. */
const KEEPER: UnitDescriptor = { ...FIXTURE, type: "fixture-keeper", capabilities: ["length:exact-video"], lengthUnknownReason: undefined }

const fixed = (sec: number) => ({ fixedSec: sec, perEpisodeSec: 0 })
const wire = (kind: WireInput["kind"], length: WireLength, handle: string | null): WireInput => ({ sourceId: `${kind}-${handle ?? "w"}`, handle, kind, length })
/** Every shape of input a rule reads: known, per-episode, unknown and absent lengths, on every handle. */
const BATTERY: WireInput[][] = [
  [],
  [wire("video", fixed(30), "video")],
  [wire("video", fixed(30), "in"), wire("audio", fixed(20), "audio")],
  [wire("video", { fixedSec: 0, perEpisodeSec: 60 }, "video"), wire("audio", undefined, "audio")],
  [wire("video", "unknown", "media"), wire("other", undefined, null)],
]
const DATA: Record<string, unknown>[] = [{}, { duration: 12, provider: "seedance-2" }]

/** video-output-length.ts loaded with `units` as the node units' descriptors. */
async function loadWith(units: ReadonlyArray<UnitDescriptor> | null): Promise<LengthModule> {
  vi.resetModules()
  // null = the real descriptors: unmock, or a mock set earlier in the same test would still answer.
  if (!units) vi.doUnmock("../unit-descriptors.js")
  if (units) {
    vi.doMock("../unit-descriptors.js", () => ({
      UNIT_NODE_DESCRIPTORS: units,
      unitDescriptorOf: (type: string | undefined) => units.find((u) => u.type === type),
    }))
  }
  return import("../video-output-length.js")
}

/** What every rule of `mod` answers on the battery: the behaviour a table carries, comparable across module instances. */
function behaviour(mod: LengthModule): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(mod.VIDEO_OUTPUT_LENGTH_RULES).map(([type, rule]) => [
      type,
      { via: rule.via, runs: rule.run ? DATA.flatMap((data) => BATTERY.map((inputs) => rule.run!({ id: "n", type, data }, inputs))) : null },
    ]),
  )
}

afterEach(() => {
  vi.doUnmock("../unit-descriptors.js")
  vi.resetModules()
})

describe("unitUnknownLengths: the rows a \"length:unknown\" unit adds", () => {
  it("adds nothing without the capability (no unit, or another length:* capability)", async () => {
    const { unitUnknownLengths } = await loadWith(null)
    expect(unitUnknownLengths([])).toEqual({ rules: {}, reasons: {} })
    expect(unitUnknownLengths([KEEPER])).toEqual({ rules: {}, reasons: {} })
  })

  it("gives the unit the very rule a hand-written unbounded node (render-video) has, and the reason its manifest states", async () => {
    const { unitUnknownLengths, VIDEO_OUTPUT_LENGTH_RULES } = await loadWith(null)
    const { rules, reasons } = unitUnknownLengths([FIXTURE, KEEPER])
    expect(Object.keys(rules)).toEqual(["fixture-echo"])
    expect(reasons).toEqual({ "fixture-echo": FIXTURE.lengthUnknownReason })
    const legacy = VIDEO_OUTPUT_LENGTH_RULES["render-video"]!
    const unit = rules["fixture-echo"]!
    expect(unit.via).toBe(legacy.via)
    for (const data of DATA) for (const inputs of BATTERY) {
      expect(unit.run!({ id: "n", type: "fixture-echo", data }, inputs)).toBe("unknown")
      expect(unit.run!({ id: "n", type: "fixture-echo", data }, inputs)).toBe(legacy.run!({ id: "n", type: "render-video", data }, inputs))
    }
  })

  it("each unit's own reason flows through (never a shared stand-in); a missing one throws", async () => {
    const { unitUnknownLengths } = await loadWith(null)
    const other: UnitDescriptor = { ...FIXTURE, type: "fixture-other", lengthUnknownReason: "its length is the other fixture's" }
    expect(unitUnknownLengths([FIXTURE, other]).reasons).toEqual({
      "fixture-echo": "its length is the fixture's, which only the file says",
      "fixture-other": "its length is the other fixture's",
    })
    expect(() => unitUnknownLengths([{ ...FIXTURE, lengthUnknownReason: undefined }])).toThrow(/fixture-echo: the "length:unknown" capability needs lengthUnknownReason/)
  })
})

describe("the module composes the units' rows into both tables", () => {
  it("a fixture unit with the capability is an unbounded producer, named in UNBOUNDED_LENGTH_REASONS", async () => {
    const mod = await loadWith([FIXTURE])
    expect(mod.VIDEO_OUTPUT_LENGTH_RULES["fixture-echo"]?.via).toBe("rule")
    expect(mod.videoOutputLength({ id: "n", type: "fixture-echo", data: {} }, BATTERY[1]!)).toBe("unknown")
    expect(mod.UNBOUNDED_LENGTH_REASONS["fixture-echo"]).toBe(FIXTURE.lengthUnknownReason)
    // video-output-length.test.ts's invariant holds for the unit too: what can return "unknown" on known inputs
    // (and on an audio with no length yet) is named in UNBOUNDED_LENGTH_REASONS, and only that.
    const handles = ["video", "in", "media"]
    const knownInputs = [...handles.map((h) => wire("video", fixed(30), h)), wire("audio", fixed(20), "audio")]
    const audioUnknown = [...handles.map((h) => wire("video", fixed(30), h)), wire("audio", undefined, "audio")]
    const unbounded = Object.entries(mod.VIDEO_OUTPUT_LENGTH_RULES)
      .filter(([type, rule]) => rule.via === "rule" && [knownInputs, audioUnknown].some((inputs) => mod.videoOutputLength({ id: "n", type, data: {} }, inputs) === "unknown"))
      .map(([type]) => type)
    expect(unbounded).toContain("fixture-echo")
    expect(unbounded.sort()).toEqual(Object.keys(mod.UNBOUNDED_LENGTH_REASONS).filter((t) => mod.VIDEO_OUTPUT_LENGTH_RULES[t]?.via === "rule").sort())
    // A unit's rule never reaches the pass-through set, nor shifts a hand-written row.
    expect(mod.PASS_THROUGH_VIDEO_TYPES).not.toContain("fixture-echo")
    const none = await loadWith([])
    expect(behaviour(mod)).toEqual({ ...behaviour(none), "fixture-echo": behaviour(mod)["fixture-echo"] })
    expect(mod.UNBOUNDED_LENGTH_REASONS).toEqual({ ...none.UNBOUNDED_LENGTH_REASONS, "fixture-echo": FIXTURE.lengthUnknownReason })
  })

  it("a type that is both hand-written and a \"length:unknown\" unit fails at load (a type lives in one place)", async () => {
    await expect(loadWith([{ ...FIXTURE, type: "render-video" }])).rejects.toThrow(/exactly one place/)
  })
})

// gif-to-video's migration (decided 2026-10-18): its hand-written rows moved into
// its unit (capability "length:unknown", lengthUnknownReason in unit.json). The
// tables are the ones composed with no unit, plus exactly the rows it had: the
// unbounded rule (every input → "unknown") and its reason, verbatim.
const GIF_LEGACY_REASON = "its length is the GIF's, which only the file says"

describe("zero change: gif-to-video's legacy rows, moved into its unit", () => {
  it("the live tree composes the tables with no unit plus gif-to-video's former rows", async () => {
    const none = await loadWith([])
    const live = await loadWith(null)
    expect(none.VIDEO_OUTPUT_LENGTH_RULES["gif-to-video"]).toBeUndefined()
    expect(Object.keys(live.VIDEO_OUTPUT_LENGTH_RULES).sort()).toEqual([...Object.keys(none.VIDEO_OUTPUT_LENGTH_RULES), "gif-to-video"].sort())
    const unknownEverywhere = { via: "rule", runs: DATA.flatMap(() => BATTERY.map(() => "unknown")) }
    expect(behaviour(live)).toEqual({ ...behaviour(none), "gif-to-video": unknownEverywhere })
    expect(live.UNBOUNDED_LENGTH_REASONS).toEqual({ ...none.UNBOUNDED_LENGTH_REASONS, "gif-to-video": GIF_LEGACY_REASON })
    expect(live.PASS_THROUGH_VIDEO_TYPES).toEqual(none.PASS_THROUGH_VIDEO_TYPES)
  })
})

import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { editPlanModeRefusalMessage } from "../../../lib/private-plugins/edit-plan-mode-gate.js"

// Mirrors payload-builder-ltx-credit-id.test.ts's harness: buildPayload is a
// pure function of (node, jobId, resolvedInputs, usageLogId, ctx) — no mocks.
//
// Regression: an orchestrated edit-plan run whose MASTER source is a
// reference-audio / youtube (or direct-URL) node exposes NO duration on its
// node data at reserve time (its length isn't known until the audio is
// fetched, and its live orchestrator output is a bare URL). The reserve used to
// bucket to the 180-minute CEILING — `edit-plan:tighten:standard:180m` (base
// 720; at a 10% cost_markup_percent that rounds 720×1.1 = 792.0000000000001 up
// to the 793 the user was charged — the only percent that produces it via the
// IEEE-754 ceil) — instead of the 60m bucket a ~59-min episode belongs in
// (base 240).
//
// THIS file pins the buildPayload FALLBACK beneath the probe-at-reserve: the
// authoritative reserve basis is `computeEditPlanReserveId`'s ffprobe of the
// master (see lib/__tests__/edit-plan-pricing.test.ts), but buildPayload cannot
// ffprobe, so it reserves on the master source node's own duration when it has
// one, else the transcript's own clock (a required input and the timing map of
// that same master), else the ceiling. That transcript basis is what stands
// when the reserve-path probe can't run (unprobeable/unreachable master).

const ctx = { nodes: [], edges: [], nodeStates: {} }

const node = (data: Record<string, unknown>) => ({
  id: "ep1",
  type: "edit-plan",
  data: { mode: "tighten", planTier: "standard", ...data },
})

const build = (data: Record<string, unknown>, resolvedInputs: Record<string, unknown>) =>
  buildPayload(node(data) as never, "job-1", resolvedInputs as never, undefined, ctx as never)

// A 59.4-minute episode's transcript: last word ends at 3,564,000 ms.
const transcript59m = {
  version: 1,
  words: [
    { text: "welcome", startMs: 0, endMs: 800 },
    { text: "goodbye", startMs: 3_563_000, endMs: 3_564_000 },
  ],
}

// The reference-audio source row as input-resolver builds it: nodeId + url +
// kind, and CRITICALLY no `duration` key (the node exposes none).
const urlSourceRow = { nodeId: "src-audio", url: "https://cdn.example/episode.m4a", kind: "audio" as const }

describe("edit-plan orchestrated reserve — URL/reference-audio master buckets by transcript", () => {
  it("a ~59-min episode reserves the 60m bucket, not the 180m ceiling", () => {
    const out = build(
      {},
      { transcript: JSON.stringify(transcript59m), editPlanSources: [urlSourceRow] },
    )
    // Was `edit-plan:tighten:standard:180m` (base 720 → 793 charged). Now 60m.
    expect(out.modelIdentifier).toBe("edit-plan:tighten:standard:60m")
    expect((out.payload as { reservedCreditId?: string }).reservedCreditId).toBe(
      "edit-plan:tighten:standard:60m",
    )
  })

  it("an inline (non-stringified) transcript object works too", () => {
    const out = build({}, { transcript: transcript59m, editPlanSources: [urlSourceRow] })
    expect(out.modelIdentifier).toBe("edit-plan:tighten:standard:60m")
  })

  it("the source node's OWN duration wins over the transcript when present", () => {
    // upload-audio master with a known 20-min length → the 30m bucket, even
    // though the transcript would imply 60m — the media length is authoritative.
    const out = build(
      {},
      {
        transcript: JSON.stringify(transcript59m),
        editPlanSources: [{ ...urlSourceRow, duration: 20 * 60 }],
      },
    )
    expect(out.modelIdentifier).toBe("edit-plan:tighten:standard:30m")
  })

  it("mode/tier still drive the composite (chapters + premium)", () => {
    const out = build(
      { mode: "chapters", planTier: "premium" },
      { transcript: JSON.stringify(transcript59m), editPlanSources: [urlSourceRow] },
    )
    expect(out.modelIdentifier).toBe("edit-plan:chapters:premium:60m")
  })

  it("an empty transcript falls to the ceiling — the safe over-reserve direction", () => {
    const out = build(
      {},
      { transcript: JSON.stringify({ version: 1, words: [] }), editPlanSources: [urlSourceRow] },
    )
    expect(out.modelIdentifier).toBe("edit-plan:tighten:standard:180m")
  })
})

// The orchestrated path bypasses the /v1/edit-plan route's Zod (count 1..50), so
// an unbounded node setting used to reach the planner — and fan out one paid
// render per clip — unclamped. The frontend estimate prices at most 50.
describe("edit-plan orchestrated payload — clip count is clamped like the request schema", () => {
  const clips = (count: unknown) =>
    (build({ mode: "clips", count }, { transcript: transcript59m, editPlanSources: [urlSourceRow] }).payload as { count?: number }).count

  it("passes an in-range count through", () => {
    expect(clips(5)).toBe(5)
  })
  it("clamps an absurd count to 50 and floors a fraction", () => {
    expect(clips(9000)).toBe(50)
    expect(clips(7.9)).toBe(7)
  })
  it("sends no count for a missing / non-positive / non-numeric one (the planner uses its default)", () => {
    expect(clips(undefined)).toBeUndefined()
    expect(clips(0)).toBeUndefined()
    expect(clips(-3)).toBeUndefined()
    expect(clips("12")).toBeUndefined()
  })
  it("never sends a count outside clips mode", () => {
    const out = build({ mode: "tighten", count: 5 }, { transcript: transcript59m, editPlanSources: [urlSourceRow] })
    expect((out.payload as { count?: number }).count).toBeUndefined()
  })
})

// Track D1: trailer mode reserves its own composite (priced like clips) and
// carries the delivery aspect, but none of the clips-only levers.
describe("edit-plan orchestrated payload — trailer mode", () => {
  const trailer = (data: Record<string, unknown>) =>
    build({ mode: "trailer", ...data }, { transcript: transcript59m, editPlanSources: [urlSourceRow] })

  it("reserves the trailer composite for the master's bucket", () => {
    const out = trailer({})
    expect(out.modelIdentifier).toBe("edit-plan:trailer:standard:60m")
    const payload = out.payload as { mode?: string; reservedCreditId?: string }
    expect(payload.mode).toBe("trailer")
    expect(payload.reservedCreditId).toBe("edit-plan:trailer:standard:60m")
  })

  it("passes the target aspect and drops the clips-only count and target length", () => {
    const payload = trailer({ count: 5, targetDurationSec: 30, targetAspect: "9:16" }).payload as Record<string, unknown>
    expect(payload.targetAspect).toBe("9:16")
    expect(payload.count).toBeUndefined()
    expect(payload.targetDurationSec).toBeUndefined()
  })
})

// Round 4 (decided 2026-10-06): an UNKNOWN mode fails the node before the
// reservation, with the message every lane uses — never planned (and charged)
// as tighten. The orchestrator loads no plugin, so a known but undeclared mode
// (trailer on a plugin that predates it) is the worker gate's to refuse.
describe("edit-plan orchestrated payload — unknown mode", () => {
  const withMode = (mode: unknown) => () =>
    build({ mode }, { transcript: transcript59m, editPlanSources: [urlSourceRow] })

  it("refuses an unknown mode with the shared message instead of reserving tighten", () => {
    expect(withMode("montage")).toThrow(editPlanModeRefusalMessage("montage"))
    expect(withMode("Clips")).toThrow(editPlanModeRefusalMessage("Clips"))
    expect(withMode(3)).toThrow(editPlanModeRefusalMessage("3"))
  })

  it("an absent mode is the node's default, tighten", () => {
    const out = withMode(undefined)()
    expect(out.modelIdentifier).toBe("edit-plan:tighten:standard:60m")
    expect((out.payload as { mode?: string }).mode).toBe("tighten")
  })
})

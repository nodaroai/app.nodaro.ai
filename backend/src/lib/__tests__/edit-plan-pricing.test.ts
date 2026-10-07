import { describe, expect, it, vi, beforeEach } from "vitest"
import { buildEditPlanCreditId, transcriptDurationSec } from "@nodaro/shared"

const mocks = vi.hoisted(() => ({ probe: vi.fn() }))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: mocks.probe }))

import { computeEditPlanReserveId } from "../edit-plan-pricing.js"

// A URL/reference-audio master carries no duration on the payload's source row.
const masterRow = { id: "src-audio", url: "https://cdn.example/episode.m4a", kind: "audio" }

describe("computeEditPlanReserveId — probe-at-reserve buckets on the master's ffprobed length", () => {
  beforeEach(() => vi.clearAllMocks())

  it("a 59.4-min master reserves the 60m bucket and stamps the payload", async () => {
    mocks.probe.mockResolvedValue(3564) // 59.4 min
    const payload: Record<string, unknown> = { mode: "tighten", planTier: "standard", sources: [masterRow], reservedCreditId: "edit-plan:tighten:standard:180m" }
    const id = await computeEditPlanReserveId("edit-plan", payload)
    expect(id).toBe("edit-plan:tighten:standard:60m")
    expect(mocks.probe).toHaveBeenCalledWith(masterRow.url)
    // The gate reads reservedCreditId off the payload; settlement/audit read probedDurationSec.
    expect(payload.reservedCreditId).toBe("edit-plan:tighten:standard:60m")
    expect(payload.probedDurationSec).toBe(3564)
  })

  it("BOUNDARY/STRADDLE: the probe buckets ABOVE where the transcript alone would have — preventing the plugin gate refusal", () => {
    // Speech ends at 59.5 min but the media runs 61 min (a real outro the
    // transcript doesn't cover). The transcript-only fallback would bucket to
    // 60m and the plugin's re-probe (per review: refuses when the master exceeds
    // the reserved bucket) would REFUSE the paid job. The probe sees 61 min and
    // reserves 90m up front, so the gate passes.
    const speechEndSec = 59.5 * 60 // 3570 — what transcriptDurationSec would report
    const trueMediaSec = 61 * 60 // 3660 — what ffprobe reports
    const transcriptBucket = buildEditPlanCreditId("tighten", "standard", transcriptDurationSec({ words: [{ endMs: speechEndSec * 1000 }] }))
    const probeBucket = buildEditPlanCreditId("tighten", "standard", trueMediaSec)
    expect(transcriptBucket).toBe("edit-plan:tighten:standard:60m") // would straddle → gate refuses
    expect(probeBucket).toBe("edit-plan:tighten:standard:90m") // probe reserves the covering bucket
  })

  it("the probe path returns the 90m id for that same 61-min master", async () => {
    mocks.probe.mockResolvedValue(61 * 60)
    const payload: Record<string, unknown> = { mode: "tighten", planTier: "standard", sources: [masterRow] }
    expect(await computeEditPlanReserveId("edit-plan", payload)).toBe("edit-plan:tighten:standard:90m")
  })

  it("probes the declared master-audio source, not just the first wired source", async () => {
    mocks.probe.mockResolvedValue(1800) // 30 min
    const music = { id: "src-music", url: "https://cdn.example/bed.mp3", kind: "audio" }
    const master = { id: "src-master", url: "https://cdn.example/host.m4a", kind: "audio", role: "master-audio" }
    const payload: Record<string, unknown> = { mode: "clips", planTier: "premium", sources: [music, master] }
    const id = await computeEditPlanReserveId("edit-plan", payload)
    expect(mocks.probe).toHaveBeenCalledWith(master.url) // the master, not `music`
    expect(id).toBe("edit-plan:clips:premium:30m")
  })

  // Round 4 (decided 2026-10-06): never re-price an unknown mode as tighten.
  // buildPayload refuses one before this runs; this keeps the reserve honest anyway.
  it("an unknown mode → undefined, no probe, payload untouched", async () => {
    mocks.probe.mockResolvedValue(1800)
    const payload: Record<string, unknown> = { mode: "montage", planTier: "standard", sources: [masterRow] }
    expect(await computeEditPlanReserveId("edit-plan", payload)).toBeUndefined()
    expect(mocks.probe).not.toHaveBeenCalled()
    expect(payload.reservedCreditId).toBeUndefined()
  })

  it("an unprobeable master → undefined (buildPayload's transcript/ceiling basis stands), payload untouched", async () => {
    mocks.probe.mockRejectedValue(new Error("ffprobe exited 1"))
    const payload: Record<string, unknown> = { mode: "tighten", planTier: "standard", sources: [masterRow], reservedCreditId: "edit-plan:tighten:standard:60m" }
    expect(await computeEditPlanReserveId("edit-plan", payload)).toBeUndefined()
    // The fallback basis buildPayload already reserved is left exactly as-is.
    expect(payload.reservedCreditId).toBe("edit-plan:tighten:standard:60m")
    expect(payload.probedDurationSec).toBeUndefined()
  })

  it.each([0, NaN, -5])("a non-positive/NaN probe → undefined (never lowers the hold): %s", async (bad) => {
    mocks.probe.mockResolvedValue(bad)
    expect(await computeEditPlanReserveId("edit-plan", { mode: "tighten", planTier: "standard", sources: [masterRow] })).toBeUndefined()
  })

  it("no sources / no url → undefined, no probe attempted", async () => {
    expect(await computeEditPlanReserveId("edit-plan", { sources: [] })).toBeUndefined()
    expect(await computeEditPlanReserveId("edit-plan", { sources: [{ id: "x", kind: "audio" }] })).toBeUndefined()
    expect(await computeEditPlanReserveId("edit-plan", {})).toBeUndefined()
    expect(mocks.probe).not.toHaveBeenCalled()
  })

  it("does not touch any other job type", async () => {
    expect(await computeEditPlanReserveId("dubbing", { sources: [masterRow] })).toBeUndefined()
    expect(mocks.probe).not.toHaveBeenCalled()
  })
})

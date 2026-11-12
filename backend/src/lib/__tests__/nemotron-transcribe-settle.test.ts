import { beforeEach, describe, expect, it, vi } from "vitest"

const shared = vi.hoisted(() => ({ commitJobCredits: vi.fn(), commitJobCreditsAtActualPrice: vi.fn() }))
vi.mock("../../workers/shared.js", () => ({
  commitJobCredits: shared.commitJobCredits,
  commitJobCreditsAtActualPrice: shared.commitJobCreditsAtActualPrice,
}))

import { nemotronChargeId, nemotronLengthsDisagree, settleNemotronTranscribe } from "../nemotron-transcribe-settle.js"

/**
 * Nemotron 3.5 Transcribe is held at the measured minutes and charged for the
 * minutes KIE decoded (decided 2026-11-12) — exactly ONE commit either way.
 */
let error: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  error = vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

function commits(): number {
  return shared.commitJobCredits.mock.calls.length + shared.commitJobCreditsAtActualPrice.mock.calls.length
}
function alerted(): boolean {
  return error.mock.calls.some((c: unknown[]) => String(c[0]).startsWith("[ALERT]"))
}

describe("settleNemotronTranscribe", () => {
  it("KIE's minutes are the held minutes: the reserved tier, unchanged, no alert", async () => {
    await settleNemotronTranscribe({ usageLogId: "ul", jobId: "j", heldId: "nemotron-3-5-transcribe:3m", measuredSec: 150, kieSec: 152 })
    expect(shared.commitJobCredits).toHaveBeenCalledWith("ul", "j")
    expect(commits()).toBe(1)
    expect(alerted()).toBe(false)
  })

  it("an under-measured file (a VBR MP3 declaring 60 s for 3:00) is charged MORE than the hold, at KIE's minutes, with an [ALERT]", async () => {
    await settleNemotronTranscribe({ usageLogId: "ul", jobId: "j", heldId: "nemotron-3-5-transcribe:1m", measuredSec: 60, kieSec: 180 })
    expect(shared.commitJobCreditsAtActualPrice).toHaveBeenCalledWith("ul", "j", "nemotron-3-5-transcribe:3m")
    expect(commits()).toBe(1)
    expect(alerted()).toBe(true)
  })

  it("an over-measured file (237 s declared for 3:00) is charged LESS than the hold", async () => {
    await settleNemotronTranscribe({ usageLogId: "ul", jobId: "j", heldId: "nemotron-3-5-transcribe:4m", measuredSec: 237, kieSec: 180 })
    expect(shared.commitJobCreditsAtActualPrice).toHaveBeenCalledWith("ul", "j", "nemotron-3-5-transcribe:3m")
    expect(commits()).toBe(1)
  })

  it("a file held at 60 minutes (its length unread) settles at KIE's minutes, with no alert", async () => {
    await settleNemotronTranscribe({ usageLogId: "ul", jobId: "j", heldId: "nemotron-3-5-transcribe:60m", kieSec: 95 })
    expect(shared.commitJobCreditsAtActualPrice).toHaveBeenCalledWith("ul", "j", "nemotron-3-5-transcribe:2m")
    expect(commits()).toBe(1)
    expect(alerted()).toBe(false)
  })

  it("an unknown hold (an older job) settles at KIE's minutes", async () => {
    await settleNemotronTranscribe({ usageLogId: "ul", jobId: "j", kieSec: 30 })
    expect(shared.commitJobCreditsAtActualPrice).toHaveBeenCalledWith("ul", "j", "nemotron-3-5-transcribe:1m")
    expect(commits()).toBe(1)
  })

  describe("when KIE reports no duration", () => {
    it.each([undefined, 0, Number.NaN])("(duration %s) charges the length KIE's credits stand for", async (kieSec) => {
      // 0.6 KIE credits at 0.3 a minute = 120 s → 2 minutes, from a 60-minute unmeasured hold.
      await settleNemotronTranscribe({ usageLogId: "ul", jobId: "j", heldId: "nemotron-3-5-transcribe:60m", kieSec, kieCredits: 0.6 })
      expect(shared.commitJobCreditsAtActualPrice).toHaveBeenCalledWith("ul", "j", "nemotron-3-5-transcribe:2m")
      expect(commits()).toBe(1)
    })

    it("then the measured length", async () => {
      await settleNemotronTranscribe({ usageLogId: "ul", jobId: "j", heldId: "nemotron-3-5-transcribe:3m", measuredSec: 150 })
      expect(shared.commitJobCredits).toHaveBeenCalledWith("ul", "j")
      expect(commits()).toBe(1)
    })

    it("an unmeasured file with no length and no credits from KIE commits the whole 60-minute hold, with an [ALERT]", async () => {
      await settleNemotronTranscribe({ usageLogId: "ul", jobId: "j", heldId: "nemotron-3-5-transcribe:60m" })
      expect(shared.commitJobCredits).toHaveBeenCalledWith("ul", "j")
      expect(commits()).toBe(1)
      expect(alerted()).toBe(true)
    })
  })

  describe("the 1 s grace upward (decided 2026-11-12)", () => {
    it("KIE at most 1 s past the held minutes' boundary is charged the held minutes", async () => {
      await settleNemotronTranscribe({ usageLogId: "ul", jobId: "j", heldId: "nemotron-3-5-transcribe:1m", measuredSec: 59.9, kieSec: 60.05 })
      expect(shared.commitJobCredits).toHaveBeenCalledWith("ul", "j")
      expect(commits()).toBe(1)
      await settleNemotronTranscribe({ usageLogId: "ul", jobId: "j2", heldId: "nemotron-3-5-transcribe:1m", measuredSec: 59.9, kieSec: 61 })
      expect(shared.commitJobCredits).toHaveBeenLastCalledWith("ul", "j2")
    })

    it("past the grace, the next minute is charged", async () => {
      await settleNemotronTranscribe({ usageLogId: "ul", jobId: "j", heldId: "nemotron-3-5-transcribe:1m", measuredSec: 59.9, kieSec: 61.01 })
      expect(shared.commitJobCreditsAtActualPrice).toHaveBeenCalledWith("ul", "j", "nemotron-3-5-transcribe:2m")
      expect(commits()).toBe(1)
    })

    it("never downward: a shorter KIE length still settles down", async () => {
      await settleNemotronTranscribe({ usageLogId: "ul", jobId: "j", heldId: "nemotron-3-5-transcribe:2m", measuredSec: 61, kieSec: 59.5 })
      expect(shared.commitJobCreditsAtActualPrice).toHaveBeenCalledWith("ul", "j", "nemotron-3-5-transcribe:1m")
      expect(commits()).toBe(1)
    })

    it("nemotronChargeId", () => {
      expect(nemotronChargeId("nemotron-3-5-transcribe:3m", 181)).toBe("nemotron-3-5-transcribe:3m")
      expect(nemotronChargeId("nemotron-3-5-transcribe:3m", 181.5)).toBe("nemotron-3-5-transcribe:4m")
      expect(nemotronChargeId(undefined, 60.5)).toBe("nemotron-3-5-transcribe:2m")
    })
  })
})

describe("nemotronLengthsDisagree — when the [ALERT] is logged", () => {
  it("different started minutes AND over one minute, or over 20 % of KIE's length", () => {
    expect(nemotronLengthsDisagree(60, 180)).toBe(true) // 2 minutes apart
    expect(nemotronLengthsDisagree(913, 3530)).toBe(true) // 58:50 declared as 15:13
    expect(nemotronLengthsDisagree(50, 70)).toBe(true) // 20 s, 29 %, minutes 1 and 2
    // Equal started minutes never alert, whatever the threshold says.
    expect(nemotronLengthsDisagree(30, 45)).toBe(false)
    expect(nemotronLengthsDisagree(150, 152)).toBe(false)
    expect(nemotronLengthsDisagree(3000, 3050)).toBe(false) // 50 s of 51 minutes
    expect(nemotronLengthsDisagree(undefined, 180)).toBe(false)
  })
})

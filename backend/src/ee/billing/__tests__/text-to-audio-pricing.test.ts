import { describe, it, expect } from "vitest"
import { TEXT_TO_AUDIO_SFX_CREDIT_IDS, textToAudioCreditId } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS } from "../credits.js"

describe("text-to-audio (elevenlabs-sfx) pricing — worked examples (must match docs/nodes/ai-audio/text-to-audio.md + migration 457)", () => {
  // (requested seconds, base credits) — the docs' worked-example table.
  const CASES = [
    [0.5, 1],
    [3, 3],
    [6, 6],
    [10, 10],
    [22, 22],
    [22.3, 23],
    [30, 30],
  ] as const

  it.each(CASES)("%s s → %i credits", (seconds, credits) => {
    expect(STATIC_CREDIT_COSTS[textToAudioCreditId("elevenlabs-sfx", seconds)]).toBe(credits)
  })

  it("no duration → billed as 5 s → 5 credits", () => {
    expect(STATIC_CREDIT_COSTS[textToAudioCreditId("elevenlabs-sfx", undefined)]).toBe(5)
  })

  it("one credit per second, for every row from 1 s to 30 s", () => {
    expect(TEXT_TO_AUDIO_SFX_CREDIT_IDS.map((id) => STATIC_CREDIT_COSTS[id])).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    )
  })

  it("the bare engine row (legacy callers) prices the no-duration default", () => {
    expect(STATIC_CREDIT_COSTS["elevenlabs-sfx"]).toBe(5)
  })
})

describe("text-to-audio workflow estimate", () => {
  it.each([
    [{ provider: "elevenlabs-sfx", duration: 10 }, 10],
    [{ provider: "elevenlabs-sfx", duration: 22 }, 22],
    [{ provider: "elevenlabs-sfx", duration: 0.5 }, 1],
    [{ provider: "elevenlabs-sfx" }, 5],
    // A node saved without a provider runs (and reserves on) the default engine.
    [{ duration: 8 }, 8],
    [{}, 5],
  ])("quotes the row the run reserves: %o → %i", async (data, credits) => {
    const { CreditsService } = await import("../credits.js")
    expect(CreditsService.estimateWorkflowBaseCredits([{ type: "text-to-audio", data }])).toBe(credits)
  })
})

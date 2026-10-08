/**
 * A speech model's `<model>:per-100-chars` row is a RATE, priced by the speech
 * estimator (use-speech-pricing), not a variant of the model. If the model
 * pickers counted it, six speech models would turn "variable-priced" and read
 * "30-30 CR" with length pricing off (the server serves no unit row) and
 * "4-30 CR" with it on (the real charge is 32-400): both wrong, and the first
 * changes today's flag-off badge.
 */
import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared"
import { creditRangesFrom, isVariablePricedModel, VARIABLE_PRICED_MODELS } from "../model-credit-range"

const SPEECH = ["elevenlabs-v3", "elevenlabs-v4", "elevenlabs-v4-turbo", "elevenlabs-turbo", "elevenlabs-multilingual", "elevenlabs-dialogue", "elevenlabs-dialogue-v4"]

describe("speech models in the model pickers", () => {
  it("are not variable-priced: the badge stays the flat 'N CR', flag off or on", () => {
    for (const id of SPEECH) {
      expect(MODEL_CATALOG[id]!.pricing.length, `${id} has a unit row`).toBeGreaterThan(1)
      expect(isVariablePricedModel(id), id).toBe(false)
    }
  })

  it("never ask the price endpoint for a speech unit row", () => {
    const asked = VARIABLE_PRICED_MODELS.flatMap(([, ids]) => ids)
    expect(asked.filter((id) => SPEECH.some((m) => id === `${m}:per-100-chars`))).toEqual([])
  })

  it("leave the range of a genuinely variable model as it was", () => {
    expect(isVariablePricedModel("nano-banana-2")).toBe(true)
    expect(creditRangesFrom({ "nano-banana-2": 20, "nano-banana-2:2K": 50 })["nano-banana-2"]).toBeDefined()
    expect(creditRangesFrom({ "elevenlabs-v4": 30, "elevenlabs-v4:per-100-chars": 4 })["elevenlabs-v4"]).toBeUndefined()
  })
})

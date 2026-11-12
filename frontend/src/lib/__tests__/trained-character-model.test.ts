/**
 * The editor's single-node Run switches to a character's trained model only
 * where the deployment offers it (decided 2026-11-12): the same rule as the
 * server's (backend lib/trained-character-model.ts), asked only of a deployment
 * that restricts models.
 */
import { describe, it, expect, afterEach } from "vitest"
import { FLUX_LORA_CHARACTER_MODEL_ID } from "@nodaro/shared/models"
import { __resetSurfaceAvailabilityForTests } from "../surface-availability"
import { trainedCharacterModelWithheld } from "../trained-character-model"

afterEach(() => __resetSurfaceAvailabilityForTests(null))

describe("trainedCharacterModelWithheld", () => {
  it("is true where a model restriction withholds the trained model", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [FLUX_LORA_CHARACTER_MODEL_ID], modelsRestricted: true })
    expect(trainedCharacterModelWithheld()).toBe(true)
  })

  it("is false where the restriction offers it", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: ["gpt-image-2"], modelsRestricted: true })
    expect(trainedCharacterModelWithheld()).toBe(false)
  })

  it("is false on a deployment that restricts nothing, even with the model's row switched off (that run is refused as before)", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [FLUX_LORA_CHARACTER_MODEL_ID], modelsRestricted: false })
    expect(trainedCharacterModelWithheld()).toBe(false)
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [] })
    expect(trainedCharacterModelWithheld()).toBe(false)
  })
})

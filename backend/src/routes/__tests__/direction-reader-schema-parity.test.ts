import { describe, it, expect } from "vitest"
import { generateImageBody } from "../generate-image.js"
import { readDirectionFields, readStructuredFields, DIRECTION_KEYS } from "@nodaro/prompts"

/**
 * The `/v1/generate-image` wire schema and the canvas node-data readers are two
 * doors into the SAME assembly. Their key sets can no longer drift — both are
 * derived from `DIRECTION_FIELDS` — so what is worth pinning is the VALUE
 * level: a realistic body that the route accepts must survive the readers
 * unchanged, or a production authored through the API would fold differently
 * once its graph is re-run on the canvas.
 *
 * The two are deliberately NOT identical on every input: the schema accepts the
 * empty string (a pre-registry client stored them) and the readers drop it, and
 * the readers bound value length where the schema bounds it differently. That
 * asymmetry is by design — a request body has already passed Fastify's limits,
 * persisted JSONB has passed nothing. Hence "realistic body", not "any input the
 * schema accepts".
 */
describe("direction/structured: wire schema ↔ node-data reader parity", () => {
  const body = {
    prompt: "a knight on a hill",
    provider: "nano-banana-pro",
    direction: {
      framingId: "medium-shot",
      lightingId: "golden-hour",
      style: "cinematic",
      mood: ["serene", "tense"],
      shotSize: "medium-shot",
    },
    structured: {
      person: { age: 34, gender: "woman", hair: "auburn", eyes: "green" },
      styling: { mood: "brooding", lighting: "soft" },
      setting: { era: "1970s", atmosphere: "humid", backdrop: "a rain-slick street" },
      camera: { framing: "medium", motion: "slow push", format: "35mm" },
      lens: { focalLength: "85mm", aperture: "1.4" },
      mood: "brooding",
    },
  }

  it("accepts the realistic maximal body", () => {
    const parsed = generateImageBody.safeParse(body)
    expect(parsed.success).toBe(true)
  })

  it("round-trips a schema-accepted direction through readDirectionFields unchanged", () => {
    const parsed = generateImageBody.parse(body)
    expect(readDirectionFields(parsed.direction)).toEqual(body.direction)
  })

  it("round-trips a schema-accepted structured through readStructuredFields unchanged", () => {
    const parsed = generateImageBody.parse(body)
    expect(readStructuredFields(parsed.structured)).toEqual(body.structured)
  })

  it("every fixture direction key is a real registry dimension", () => {
    // Keeps the fixture honest: a typo'd key would be stripped by the
    // non-strict schema AND dropped by the reader, making the round-trip pass
    // vacuously.
    for (const key of Object.keys(body.direction)) {
      expect(DIRECTION_KEYS).toContain(key)
    }
  })
})

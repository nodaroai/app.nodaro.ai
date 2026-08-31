import { describe, it, expect } from "vitest"
import { generateImageBody } from "../generate-image.js"
import {
  readDirectionFields,
  readStructuredFields,
  DIRECTION_KEYS,
  DIRECTION_ARRAY_CEILING,
  DIRECTION_ID_MAX_CHARS,
} from "@nodaro/prompts"

/**
 * The `/v1/generate-image` wire schema and the canvas node-data readers are two
 * doors into the SAME assembly. Their key sets can no longer drift — both are
 * derived from `DIRECTION_FIELDS` — so what is worth pinning is the VALUE
 * level: a realistic body that the route accepts must survive the readers
 * unchanged, or a production authored through the API would fold differently
 * once its graph is re-run on the canvas.
 *
 * On DIRECTION the two bounds are now the SAME literals — both doors import
 * `DIRECTION_ID_MAX_CHARS` / `DIRECTION_ARRAY_CEILING` from `@nodaro/prompts` —
 * so the only remaining direction-level difference is the empty string, which
 * the schema accepts (a pre-registry client stored them) and the reader drops;
 * the renderer drops it either way, so nothing diverges downstream.
 *
 * ONE REAL DIVERGENCE remains, pinned below: `structured` string fields are
 * UNBOUNDED on the wire (`z.string().optional()`) and bounded at 200 chars in
 * the reader. It is deliberate and asymmetric on purpose — a request body has
 * already passed Fastify's limits, persisted JSONB has passed nothing, and
 * bounding the route instead would be a new 400 on currently-accepted input.
 * Hence "realistic body", not "any input the schema accepts".
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

  it("agrees with the schema on the direction bounds (shared constants, not re-typed)", () => {
    const tooLong = "x".repeat(DIRECTION_ID_MAX_CHARS + 1)
    const atMax = "x".repeat(DIRECTION_ID_MAX_CHARS)
    expect(generateImageBody.safeParse({ ...body, direction: { style: tooLong } }).success).toBe(
      false,
    )
    expect(readDirectionFields({ style: tooLong })).toBeUndefined()
    expect(generateImageBody.safeParse({ ...body, direction: { style: atMax } }).success).toBe(true)
    expect(readDirectionFields({ style: atMax })).toEqual({ style: atMax })

    // Over the array ceiling the two doors differ in KIND, not in outcome: the
    // route 400s, the reader (which has no way to 400 a stored graph) keeps the
    // same prefix the route would have accepted.
    const over = Array.from({ length: DIRECTION_ARRAY_CEILING + 1 }, (_, i) => `id-${i}`)
    expect(generateImageBody.safeParse({ ...body, direction: { mood: over } }).success).toBe(false)
    expect(readDirectionFields({ mood: over })).toEqual({
      mood: over.slice(0, DIRECTION_ARRAY_CEILING),
    })
  })

  it("pins the ONE deliberate divergence: unbounded structured strings on the wire", () => {
    // If the route ever grows a `.max()` on these, this test is the place that
    // says what the reader's 200-char bound must then agree with.
    const long = "x".repeat(201)
    const parsed = generateImageBody.safeParse({
      ...body,
      structured: { setting: { backdrop: long } },
    })
    expect(parsed.success).toBe(true)
    expect(readStructuredFields({ setting: { backdrop: long } })).toBeUndefined()
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

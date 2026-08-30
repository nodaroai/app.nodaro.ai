import { describe, it, expect, expectTypeOf } from "vitest"
import type { z } from "zod"
import { DIRECTION_ARRAY_CEILING, DIRECTION_KEYS, type DirectionKey } from "@nodaro/prompts"
import { directionSchema } from "../direction-schema.js"

/**
 * `directionSchema` is DERIVED from the `DIRECTION_FIELDS` registry table, so
 * the drift guard below is the whole point of the file: if the derivation ever
 * degrades into a hand list (or the `as Record<DirectionKey, …>` cast is
 * dropped and `z.infer` widens to `Record<string, …>`), these assertions fail.
 *
 * The rest pins the schema's DELIBERATE TOLERANCE — a wire that degrades
 * instead of 400ing is what makes a client/platform version skew survivable.
 */

// ── KEY-SET DRIFT GUARD (the house pattern from generate-image.test.ts) ──────
describe("directionSchema mirrors the registry (key-set drift guard)", () => {
  type SchemaKeys = keyof z.infer<typeof directionSchema>
  // `Exclude<A, B>` is `never` iff every member of A is in B. Asserted both
  // ways, the two key sets are pinned EQUAL at compile time.
  type MissingFromSchema = Exclude<DirectionKey, SchemaKeys>
  type ExtraInSchema = Exclude<SchemaKeys, DirectionKey>

  it("has no registry key missing from the schema", () => {
    expectTypeOf<MissingFromSchema>().toEqualTypeOf<never>()
  })

  it("has no schema key missing from the registry", () => {
    expectTypeOf<ExtraInSchema>().toEqualTypeOf<never>()
  })

  it("carries exactly the registry's keys at runtime", () => {
    expect(Object.keys(directionSchema.shape).sort()).toEqual([...DIRECTION_KEYS].sort())
  })

  it("accepts BOTH surfaces' keys — surface is a render concern, not a wire concern", () => {
    // An image-only key and a video-only key on ONE body: both parse, and the
    // renderer decides which contributes a hint.
    const parsed = directionSchema.parse({ aperture: "aperture-f1-4", cameraMotion: "handheld" })
    expect(parsed).toEqual({ aperture: "aperture-f1-4", cameraMotion: "handheld" })
  })
})

describe("directionSchema — value tolerance", () => {
  it("accepts a bare string id", () => {
    expect(directionSchema.parse({ style: "anime" })).toEqual({ style: "anime" })
  })

  it("accepts an array of ids", () => {
    expect(directionSchema.parse({ mood: ["happy", "joyful"] })).toEqual({
      mood: ["happy", "joyful"],
    })
  })

  it("accepts the EMPTY string (no `.min(1)` — that would be a new 400 on input the 5-key schema took)", () => {
    expect(directionSchema.parse({ style: "" })).toEqual({ style: "" })
  })

  it("accepts an empty object (every key optional)", () => {
    expect(directionSchema.parse({})).toEqual({})
  })

  it("accepts an over-cap array up to the wire ceiling — the semantic cap is the renderer's slice", () => {
    const four = ["happy", "joyful", "relieved", "tense"]
    expect(directionSchema.parse({ mood: four })).toEqual({ mood: four })
  })

  it("STRIPS an unknown key instead of rejecting it (non-strict, deliberately)", () => {
    // A newer client on an older API loses the unknown dimensions QUIETLY —
    // which is why platform-first deploy ordering is load-bearing.
    expect(directionSchema.parse({ style: "anime", notAKey: "whatever" })).toEqual({
      style: "anime",
    })
  })

  it("rejects a non-string value", () => {
    expect(directionSchema.safeParse({ style: 42 }).success).toBe(false)
    expect(directionSchema.safeParse({ style: { id: "anime" } }).success).toBe(false)
  })

  it("rejects an array longer than the wire ceiling", () => {
    const tooMany = Array.from({ length: DIRECTION_ARRAY_CEILING + 1 }, (_, i) => `id-${i}`)
    expect(directionSchema.safeParse({ mood: tooMany }).success).toBe(false)
  })

  it("rejects an unbounded id string", () => {
    expect(directionSchema.safeParse({ style: "x".repeat(101) }).success).toBe(false)
    expect(directionSchema.safeParse({ style: "x".repeat(100) }).success).toBe(true)
  })
})

import { describe, it, expect } from "vitest"
import { readDirectionFields, readStructuredFields } from "../read-node-direction.js"
import { DIRECTION_KEYS } from "../direction-registry.js"

/**
 * The narrow readers are the ONLY thing standing between untrusted persisted
 * node JSONB (`workflows.nodes` — import, MCP write, node preset, a
 * Studio-emitted graph) and the prompt text a model sees. These cases pin the
 * VALUE SHAPE contract; the accepted KEY SET is not pinned here on purpose —
 * it is derived from `DIRECTION_FIELDS`, whose order + membership are pinned by
 * `direction-registry.test.ts`. A hand list here would be exactly the
 * "remember to update the list" the registry walk removes.
 */
describe("readDirectionFields", () => {
  it("rejects non-object roots", () => {
    expect(readDirectionFields(undefined)).toBeUndefined()
    expect(readDirectionFields(null)).toBeUndefined()
    expect(readDirectionFields("shotSize")).toBeUndefined()
    expect(readDirectionFields(42)).toBeUndefined()
    expect(readDirectionFields([])).toBeUndefined()
    expect(readDirectionFields([{ shotSize: "medium-shot" }])).toBeUndefined()
  })

  it("returns undefined, never {}, when nothing survives", () => {
    // Load-bearing: `{}` is a DEFINED direction, which would flip the call
    // sites' `...(x !== undefined ? { x } : {})` spread on and take the join
    // branch instead of the exact no-op branch.
    expect(readDirectionFields({})).toBeUndefined()
    expect(readDirectionFields({ shotSize: "" })).toBeUndefined()
    expect(readDirectionFields({ mood: [] })).toBeUndefined()
    expect(readDirectionFields({ mood: ["", 5, null] })).toBeUndefined()
    expect(readDirectionFields({ nothing: "here" })).toBeUndefined()
  })

  it("keeps a registry key and drops everything unrecognised", () => {
    expect(readDirectionFields({ shotSize: "medium-shot", bogus: "x" })).toEqual({
      shotSize: "medium-shot",
    })
  })

  it("accepts an array on any key and filters junk entries out of it", () => {
    expect(readDirectionFields({ mood: ["serene", "", 5, null, "tense"] })).toEqual({
      mood: ["serene", "tense"],
    })
    // An array on a single-pick key is legal at the reader; the per-dimension
    // cap is the renderer's slice, never a drop here.
    expect(readDirectionFields({ style: ["anime", "cinematic"] })).toEqual({
      style: ["anime", "cinematic"],
    })
  })

  it("drops non-string / over-length ids", () => {
    expect(readDirectionFields({ shotSize: 123, style: "anime" })).toEqual({ style: "anime" })
    expect(readDirectionFields({ shotSize: { id: "medium-shot" } })).toBeUndefined()
    const overLong = "x".repeat(101)
    expect(readDirectionFields({ shotSize: overLong })).toBeUndefined()
    expect(readDirectionFields({ shotSize: "x".repeat(100) })).toEqual({
      shotSize: "x".repeat(100),
    })
    expect(readDirectionFields({ mood: [overLong, "serene"] })).toEqual({ mood: ["serene"] })
  })

  it("honors every registry key by construction (a new dimension needs no edit here)", () => {
    const everyKey = Object.fromEntries(DIRECTION_KEYS.map((k) => [k, "some-id"]))
    expect(Object.keys(readDirectionFields(everyKey) ?? {}).sort()).toEqual(
      [...DIRECTION_KEYS].sort(),
    )
  })
})

describe("readStructuredFields", () => {
  it("rejects non-object roots and returns undefined when nothing survives", () => {
    expect(readStructuredFields(undefined)).toBeUndefined()
    expect(readStructuredFields(null)).toBeUndefined()
    expect(readStructuredFields("person")).toBeUndefined()
    expect(readStructuredFields([])).toBeUndefined()
    expect(readStructuredFields({})).toBeUndefined()
    expect(readStructuredFields({ person: "hello" })).toBeUndefined()
    expect(readStructuredFields({ person: {}, styling: [] })).toBeUndefined()
    expect(readStructuredFields({ nothing: "here" })).toBeUndefined()
  })

  it("drops junk field values instead of rendering them verbatim", () => {
    // `renderStructuredFields` never throws on junk but DOES render it —
    // `person: { age: "drop table" }` would become "Subject: drop table years
    // old." inside `jobs.input_data.prompt`. The field table is what blocks it.
    expect(readStructuredFields({ person: { age: "drop table" } })).toBeUndefined()
    expect(readStructuredFields({ person: { age: Number.NaN } })).toBeUndefined()
    expect(readStructuredFields({ person: { gender: "robot" } })).toBeUndefined()
    expect(readStructuredFields({ person: { hair: 7 } })).toBeUndefined()
    expect(readStructuredFields({ person: { hair: "x".repeat(201) } })).toBeUndefined()
    expect(readStructuredFields({ person: { age: 34, bogus: "x" } })).toEqual({
      person: { age: 34 },
    })
  })

  it("round-trips every group plus the mood shorthand", () => {
    const full = {
      person: {
        age: 34,
        gender: "woman",
        hair: "auburn",
        eyes: "green",
        expression: "wry",
        profession: "archivist",
        warriorType: "ranger",
      },
      styling: { mood: "brooding", lighting: "soft", aesthetic: "noir", colorLook: "teal" },
      setting: { era: "1970s", atmosphere: "humid", backdrop: "a rain-slick street" },
      camera: { framing: "medium", motion: "slow push", format: "35mm" },
      lens: { focalLength: "85mm", aperture: "1.4" },
      mood: "brooding",
    }
    expect(readStructuredFields(full)).toEqual(full)
  })

  it("keeps the surviving fields of a partially-junk group", () => {
    expect(
      readStructuredFields({ person: { age: 34, gender: "robot" }, styling: "nope" }),
    ).toEqual({ person: { age: 34 } })
  })
})

import { describe, it, expect } from "vitest"
import {
  DIRECTION_ARRAY_CEILING,
  DIRECTION_ID_MAX_CHARS,
  type DirectionFields,
  type SubjectFields,
} from "@nodaro/prompts"

import {
  copyDirection,
  copySubject,
  directionSpread,
  readNodeDirection,
  readNodeSubject,
  subjectSpread,
} from "../shot-direction"

/**
 * The node-side cinematic channel's contract: `undefined`-never-`{}` on the way
 * out, deep copies at every boundary, and a read-back that DELEGATES to the
 * platform readers so studio's bounds are exactly the canvas's.
 *
 * The reader tests deliberately assert the reader's OWN behavior (junk keys
 * dropped, over-long ids dropped, arrays truncated) rather than re-asserting the
 * value that was written — the point is that studio agrees with what a canvas run
 * would fold, not that studio has its own opinion.
 */

describe("directionSpread / subjectSpread — omit-when-empty", () => {
  it("emits nothing for undefined or an EMPTY object", () => {
    // `{}` is never legal: it takes the wrong spread branch downstream and would
    // break the byte-identical single-still round-trip.
    expect(directionSpread(undefined)).toEqual({})
    expect(directionSpread({})).toEqual({})
    expect(subjectSpread(undefined)).toEqual({})
    expect(subjectSpread({})).toEqual({})
    expect("direction" in directionSpread({})).toBe(false)
    expect("subject" in subjectSpread({})).toBe(false)
  })

  it("emits the key when something is set", () => {
    const d: DirectionFields = { shotSize: "wide-shot" }
    expect(directionSpread(d)).toEqual({ direction: d })
    const s: SubjectFields = { mood: "tense" }
    expect(subjectSpread(s)).toEqual({ subject: s })
  })
})

describe("copyDirection / copySubject — copy-on-write at the boundary", () => {
  it("copies multi-pick ARRAYS, not just the container", () => {
    const source: DirectionFields = {
      shotSize: "wide-shot",
      atmosphere: ["fog", "haze"],
    }
    const copy = copyDirection(source)
    expect(copy).toEqual(source)
    expect(copy).not.toBe(source)
    expect(copy.atmosphere).not.toBe(source.atmosphere)
    ;(copy.atmosphere as string[]).push("smoke")
    expect(source.atmosphere).toEqual(["fog", "haze"])
  })

  it("copies a multi-pick dimension's ARRAY, not just the top level", () => {
    const source: SubjectFields = {
      age: "age-30s",
      ethnicity: ["ethnicity-east-asian", "ethnicity-italian"],
      customAge: 34,
    }
    const copy = copySubject(source)
    expect(copy).toEqual(source)
    expect(copy).not.toBe(source)
    expect(copy.ethnicity).not.toBe(source.ethnicity)
    ;(copy.ethnicity as string[]).push("ethnicity-nordic")
    expect(source.ethnicity).toEqual([
      "ethnicity-east-asian",
      "ethnicity-italian",
    ])
  })
})

describe("readNodeDirection / readNodeSubject — the platform readers own the bounds", () => {
  it("drops non-registry keys, over-long ids, and truncates arrays at the ceiling", () => {
    const long = "x".repeat(DIRECTION_ID_MAX_CHARS + 1)
    const read = readNodeDirection({
      shotSize: "wide-shot",
      notARegistryKey: "whatever",
      lens: long,
      atmosphere: Array.from({ length: 12 }, (_, i) => `a-${i}`),
    })
    expect(read).toBeDefined()
    expect(read).not.toHaveProperty("notARegistryKey")
    // A studio PICKER key on a node folds nothing on the canvas — the reader is
    // where that becomes visible instead of silent.
    expect(readNodeDirection({ framingCoverageId: "x", moodId: "y" })).toBeUndefined()
    expect(read).not.toHaveProperty("lens")
    expect((read!.atmosphere as string[]).length).toBe(DIRECTION_ARRAY_CEILING)
    expect(read!.shotSize).toBe("wide-shot")
  })

  it("is `undefined`-never-`{}` for junk, empties and non-objects", () => {
    expect(readNodeDirection(undefined)).toBeUndefined()
    expect(readNodeDirection(null)).toBeUndefined()
    expect(readNodeDirection("not-an-object")).toBeUndefined()
    expect(readNodeDirection([])).toBeUndefined()
    expect(readNodeDirection({})).toBeUndefined()
    expect(readNodeDirection({ shotSize: 7 })).toBeUndefined()
    expect(readNodeSubject(undefined)).toBeUndefined()
    expect(readNodeSubject("not-an-object")).toBeUndefined()
    expect(readNodeSubject([])).toBeUndefined()
    expect(readNodeSubject({})).toBeUndefined()
    expect(readNodeSubject({ notASubjectKey: "nope" })).toBeUndefined()
  })

  it("keeps the subject FIELDS the platform recognizes, and drops the rest", () => {
    const read = readNodeSubject({
      age: "age-30s",
      ethnicity: ["eth-a", "eth-b"],
      notASubjectKey: "nope",
    })
    expect(read).toEqual({ age: "age-30s", ethnicity: ["eth-a", "eth-b"] })
  })

  it("bounds subject CARDINALITY, and leaves the semantic cap to the renderer", () => {
    // The reader's bound is the wire's own array ceiling (8), shared by
    // CONSTANT with direction's. The per-dimension `maxPicks` slice is
    // `normalizeSubjectFields`' job inside the fold — exactly the split
    // `readDirectionFields` already has.
    const read = readNodeSubject({
      ethnicity: Array.from({ length: 12 }, (_, i) => `eth-${i}`),
    })
    expect((read!.ethnicity as string[]).length).toBe(DIRECTION_ARRAY_CEILING)
  })

  it("returns a FRESH object — a node blob read twice never aliases", () => {
    const blob = { shotSize: "wide-shot", atmosphere: ["fog"] }
    const a = readNodeDirection(blob)!
    const b = readNodeDirection(blob)!
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(a.atmosphere).not.toBe(blob.atmosphere)
  })
})

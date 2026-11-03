import { describe, expect, it } from "vitest"
import { readExtrasRecord, readQuoteRecord, readReuseRecord } from "../records.js"

const RENDER_JOB = "00000000-0000-4000-8000-000000000a01"

describe("readQuoteRecord", () => {
  it("reads a version 1 quote: its hold, expected settlement, lines and extras", () => {
    expect(
      readQuoteRecord({
        v: 1,
        totalCredits: 1200,
        expectedCredits: 900,
        breakdown: { base: 40, motion: 1000, motionExpected: 700, references: 160 },
        privacyCredits: 50,
        referencesRetryCredits: 30,
      }),
    ).toEqual({
      totalCredits: 1200,
      expectedCredits: 900,
      breakdown: { base: 40, motion: 1000, motionExpected: 700, references: 160 },
      privacyCredits: 50,
      referencesRetryCredits: 30,
    })
  })

  it("a quote with no expected settlement and no extras (Full Quality's) reads them as null", () => {
    expect(readQuoteRecord({ v: 1, totalCredits: 640, breakdown: { base: 40, motionHd: 600 } })).toEqual({
      totalCredits: 640,
      expectedCredits: null,
      breakdown: { base: 40, motionHd: 600 },
      privacyCredits: null,
      referencesRetryCredits: null,
    })
  })

  it.each<[string, unknown]>([
    ["v: 2", { v: 2, totalCredits: 10, breakdown: {} }],
    ["no v", { totalCredits: 10, breakdown: {} }],
    ["v as a string", { v: "1", totalCredits: 10, breakdown: {} }],
    ["a string total", { v: 1, totalCredits: "10", breakdown: {} }],
    ["a negative total", { v: 1, totalCredits: -1, breakdown: {} }],
    ["a total that is not finite", { v: 1, totalCredits: Number.NaN, breakdown: {} }],
    ["no total", { v: 1, breakdown: {} }],
    ["not an object", "x"],
    ["null", null],
    ["an array", [{ v: 1, totalCredits: 10 }]],
  ])("%s gives null", (_label, value) => {
    expect(readQuoteRecord(value)).toBeNull()
  })

  it("drops a line that is not a finite number of 0 or more (motion: \"x\")", () => {
    const quote = readQuoteRecord({ v: 1, totalCredits: 10, breakdown: { base: 4, motion: "x", references: -2, prompt: null } })
    expect(quote?.breakdown).toEqual({ base: 4 })
  })

  it("keeps a line it does not know, so a new line is never hidden (faceMesh: 12)", () => {
    expect(readQuoteRecord({ v: 1, totalCredits: 52, breakdown: { base: 40, faceMesh: 12 } })?.breakdown).toEqual({ base: 40, faceMesh: 12 })
  })

  it("keeps the first 20 of 25 numeric lines", () => {
    const breakdown = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`line${i}`, i]))
    const kept = readQuoteRecord({ v: 1, totalCredits: 300, breakdown })?.breakdown ?? {}
    expect(Object.keys(kept)).toEqual(Array.from({ length: 20 }, (_, i) => `line${i}`))
  })

  it("drops a key that is not a plain name, and never takes one as a prototype", () => {
    const value = JSON.parse(
      `{"v":1,"totalCredits":9,"breakdown":{"__proto__":5,"bad key":1,"1motion":2,"motion-hd":3,"${"a".repeat(41)}":4,"base":9}}`,
    ) as unknown
    const quote = readQuoteRecord(value)
    expect(quote?.breakdown).toEqual({ base: 9 })
    expect(Object.getPrototypeOf(quote?.breakdown)).toBe(Object.prototype)
  })

  it("a breakdown that is not an object reads as no lines", () => {
    expect(readQuoteRecord({ v: 1, totalCredits: 10, breakdown: [1, 2] })?.breakdown).toEqual({})
    expect(readQuoteRecord({ v: 1, totalCredits: 10 })?.breakdown).toEqual({})
  })

  it("reads the expected settlement and each extra as the lines are read: else null", () => {
    expect(
      readQuoteRecord({ v: 1, totalCredits: 10, expectedCredits: "8", breakdown: {}, privacyCredits: -1, referencesRetryCredits: "30" }),
    ).toMatchObject({ expectedCredits: null, privacyCredits: null, referencesRetryCredits: null })
    expect(readQuoteRecord({ v: 1, totalCredits: 10, breakdown: {}, privacyCredits: 0 })?.privacyCredits).toBe(0)
  })
})

describe("readReuseRecord", () => {
  it("reads each entry with every field it carries, null for the rest", () => {
    expect(
      readReuseRecord({
        v: 1,
        entries: [
          { step: "reference-sheet", role: 0 },
          { step: "face-mask", attempt: "retry" },
          { step: "render", jobId: RENDER_JOB },
          { step: "clip", ref: "0123456789ab" },
        ],
      }),
    ).toEqual([
      { step: "reference-sheet", role: 0, attempt: null, jobId: null, ref: null },
      { step: "face-mask", role: null, attempt: "retry", jobId: null, ref: null },
      { step: "render", role: null, attempt: null, jobId: RENDER_JOB, ref: null },
      { step: "clip", role: null, attempt: null, jobId: null, ref: "0123456789ab" },
    ])
  })

  it("a malformed field is dropped, never the entry: role -1, attempt \"third\", jobId \"x\", a ref that is not 12 hex", () => {
    expect(
      readReuseRecord({
        v: 1,
        entries: [
          { step: "reference-sheet", role: -1 },
          { step: "photo-labels", role: 1.5 },
          { step: "styled-picture", role: "0" },
          { step: "face-mask", attempt: "third" },
          { step: "render", jobId: "x" },
          { step: "clip", ref: "0123456789AB" },
          { step: "clip", ref: "0123456789a" },
        ],
      }),
    ).toEqual([
      { step: "reference-sheet", role: null, attempt: null, jobId: null, ref: null },
      { step: "photo-labels", role: null, attempt: null, jobId: null, ref: null },
      { step: "styled-picture", role: null, attempt: null, jobId: null, ref: null },
      { step: "face-mask", role: null, attempt: null, jobId: null, ref: null },
      { step: "render", role: null, attempt: null, jobId: null, ref: null },
      { step: "clip", role: null, attempt: null, jobId: null, ref: null },
      { step: "clip", role: null, attempt: null, jobId: null, ref: null },
    ])
  })

  it("drops an entry whose step is not a step name (\"Bad Step!\"), keeps a step it does not know (\"new-thing\")", () => {
    expect(
      readReuseRecord({
        v: 1,
        entries: [{ step: "Bad Step!" }, { step: "new-thing", role: 2 }, { step: 7 }, { role: 0 }, "clip", null],
      }),
    ).toEqual([{ step: "new-thing", role: 2, attempt: null, jobId: null, ref: null }])
  })

  it("keeps a field on any step: the record is read as written, never judged by the engine's rules", () => {
    expect(readReuseRecord({ v: 1, entries: [{ step: "depth", attempt: "first", jobId: RENDER_JOB }] })).toEqual([
      { step: "depth", role: null, attempt: "first", jobId: RENDER_JOB, ref: null },
    ])
  })

  it("keeps every entry as listed, the same one twice included (a count is the reader's)", () => {
    const clip = { step: "clip", ref: "0123456789ab" }
    expect(readReuseRecord({ v: 1, entries: [clip, clip] })).toHaveLength(2)
  })

  it.each<[string, unknown]>([
    ["v: 2", { v: 2, entries: [{ step: "clip" }] }],
    ["no v", { entries: [{ step: "clip" }] }],
    ["entries that are not a list", { v: 1, entries: { step: "clip" } }],
    ["no entries", { v: 1 }],
    ["not an object", "x"],
    ["null", null],
  ])("%s gives null", (_label, value) => {
    expect(readReuseRecord(value)).toBeNull()
  })

  it("an empty version 1 record reads as no entries", () => {
    expect(readReuseRecord({ v: 1, entries: [] })).toEqual([])
  })
})

describe("readExtrasRecord", () => {
  it("keeps the quote's two extras only, each once, in the order they ran", () => {
    expect(readExtrasRecord({ v: 1, ran: ["privacyCredits", "privacyCredits", "other"] })).toEqual(["privacyCredits"])
    expect(readExtrasRecord({ v: 1, ran: ["referencesRetryCredits", 3, "privacyCredits"] })).toEqual([
      "referencesRetryCredits",
      "privacyCredits",
    ])
    expect(readExtrasRecord({ v: 1, ran: [] })).toEqual([])
  })

  it.each<[string, unknown]>([
    ["v: 2", { v: 2, ran: [] }],
    ["a string", "x"],
    ["no ran", { v: 1 }],
    ["ran that is not a list", { v: 1, ran: "privacyCredits" }],
    ["null", null],
  ])("%s gives null", (_label, value) => {
    expect(readExtrasRecord(value)).toBeNull()
  })
})

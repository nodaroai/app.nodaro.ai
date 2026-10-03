import { describe, it, expect } from "vitest"
import {
  applyMinorAgeFloorToPickerValues,
  buildPickerAnalyzerSpec,
  getAdultOnlyIds,
  isMinorAge,
} from "@nodaro/prompts"
import { createPickerFieldStream, type PickerFieldEvent } from "../picker-field-stream.js"

const TARGETS = ["person", "styling"] as const
const PERSON = buildPickerAnalyzerSpec("person")
const STYLING = buildPickerAnalyzerSpec("styling")
const ADULT_ONLY_IDS = getAdultOnlyIds()

/** A real catalog id of `dimension`: the first adult-only one, or the first that is not. */
function realId(spec: typeof PERSON, dimension: string, adultOnly: boolean): string {
  const d = spec.dimensions.find((x) => x.dimension === dimension)
  const id = d?.entryIds.find((i) => ADULT_ONLY_IDS.has(i) === adultOnly)
  if (!id) throw new Error(`no ${adultOnly ? "adult-only" : "ordinary"} id in ${dimension}`)
  return id
}

const AGE_IDS = PERSON.dimensions.find((d) => d.dimension === "age")?.entryIds ?? []
const MINOR_AGE = AGE_IDS.find((id) => isMinorAge({ age: id })) as string
const ADULT_AGE = AGE_IDS.find((id) => !isMinorAge({ age: id })) as string

const TYPE = realId(PERSON, "type", false)
const TYPE_ADULT_ONLY = realId(PERSON, "type", true)
const HAIR = realId(PERSON, "hair-color", false)
const FEATURE = realId(PERSON, "distinctive-features", false)
const FEATURE_ADULT_ONLY = realId(PERSON, "distinctive-features", true)
const BUST_ADULT_ONLY = realId(PERSON, "bust", true)
const HEADWEAR = realId(STYLING, "headwear", false)
const OUTFIT_ADULT_ONLY = realId(STYLING, "outfit", true)

function doc(age: string): Record<string, unknown> {
  return {
    person: {
      type: TYPE,
      age,
      "hair-color": [HAIR],
      "distinctive-features": [FEATURE, FEATURE_ADULT_ONLY],
      bust: BUST_ADULT_ONLY,
    },
    styling: { headwear: [HEADWEAR], outfit: OUTFIT_ADULT_ONLY },
    gaps: { missingItems: [{ picker: "person", dimension: "age", observed: "x" }], missingCategories: [] },
  }
}

function run(chunks: readonly string[], targets: readonly string[] = TARGETS): PickerFieldEvent[] {
  const out: PickerFieldEvent[] = []
  const stream = createPickerFieldStream({ targetPickers: targets, onField: (e) => out.push(e) })
  for (const chunk of chunks) stream.push(chunk)
  return out
}

function chunkings(text: string): string[][] {
  const out: string[][] = [[text]]
  for (let i = 1; i < text.length; i++) out.push([text.slice(0, i), text.slice(i)])
  for (const size of [1, 3, 8]) {
    const run: string[] = []
    for (let i = 0; i < text.length; i += size) run.push(text.slice(i, i + size))
    out.push(run)
  }
  return out
}

/** The safety promise: no streamed value holds an id the minor-age floor can remove. */
function expectNoAdultOnlyId(events: readonly PickerFieldEvent[]): void {
  for (const e of events) {
    for (const id of [e.value].flat()) expect(ADULT_ONLY_IDS.has(id), `${e.field}=${id}`).toBe(false)
  }
}

const SAFE_DETAILS = (age: string): PickerFieldEvent[] => [
  { field: "person.type", value: TYPE },
  { field: "person.age", value: age },
  { field: "person.hair-color", value: [HAIR] },
  { field: "styling.headwear", value: [HEADWEAR] },
]

describe("createPickerFieldStream", () => {
  it("emits a value exactly when the minor-age floor keeps it — every real id of every person and styling dimension", () => {
    let checked = 0
    for (const [picker, spec] of [["person", PERSON], ["styling", STYLING]] as const) {
      for (const d of spec.dimensions) {
        if (picker === "person" && d.dimension === "age") continue // the floor's own trigger
        for (const id of d.entryIds) {
          const emitted = run([JSON.stringify({ [picker]: { [d.dimension]: id } })]).length === 1
          const section = picker === "person" ? { person: { age: MINOR_AGE, [d.dimension]: id } } : { person: { age: MINOR_AGE }, [picker]: { [d.dimension]: id } }
          const floored = applyMinorAgeFloorToPickerValues(section) as Record<string, Record<string, unknown>>
          expect(emitted, `${picker}.${d.dimension}=${id}`).toBe(floored[picker]?.[d.dimension] === id)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(500)
  })

  it("streams every detail the floor can never remove the moment it closes, and holds the rest for done", () => {
    expect(run([JSON.stringify(doc(ADULT_AGE))])).toEqual(SAFE_DETAILS(ADULT_AGE))
  })

  it("streams a minor the same safe details, never one the floor removes", () => {
    const events = run([JSON.stringify(doc(MINOR_AGE))])
    expect(events).toEqual(SAFE_DETAILS(MINOR_AGE))
    expectNoAdultOnlyId(events)
  })

  it("holds an adult-only TYPE too, whatever age follows", () => {
    for (const age of [ADULT_AGE, MINOR_AGE]) {
      expect(run([JSON.stringify({ person: { type: TYPE_ADULT_ONLY, age } })])).toEqual([{ field: "person.age", value: age }])
    }
  })

  it("cannot be talked into an adult-only value by a rewritten document", () => {
    // A repeated person section (JSON.parse keeps the last) and a __proto__ key both
    // once let an "adult" reading release values the final, minor answer strips.
    const repeated = `{"person":{"age":"${ADULT_AGE}"},"styling":{"outfit":"${OUTFIT_ADULT_ONLY}"},"person":{"age":"${MINOR_AGE}"}}`
    const proto = `{"person":{"__proto__":{"age":"${ADULT_AGE}"},"type":"${TYPE}"},"styling":{"outfit":"${OUTFIT_ADULT_ONLY}"}}`
    for (const text of [repeated, proto]) expectNoAdultOnlyId(run([text]))
  })

  it("emits a detail the moment it closes, not at the end", () => {
    const text = JSON.stringify(doc(ADULT_AGE))
    const ageEnd = text.indexOf(`"${ADULT_AGE}"`) + ADULT_AGE.length + 2
    expect(run([text.slice(0, ageEnd)])).toEqual([
      { field: "person.type", value: TYPE },
      { field: "person.age", value: ADULT_AGE },
    ])
    expect(run([text.slice(0, ageEnd - 1)])).toEqual([{ field: "person.type", value: TYPE }])
  })

  it("gives the same events, and never an adult-only id, however the deltas are split", () => {
    for (const age of [ADULT_AGE, MINOR_AGE]) {
      const text = JSON.stringify(doc(age))
      const whole = run([text])
      for (const chunks of chunkings(text)) {
        const events = run(chunks)
        expect(events).toEqual(whole)
        expectNoAdultOnlyId(events)
      }
    }
  })

  it("ignores gaps, pickers it was not asked for, empty values and non-string arrays", () => {
    const text = JSON.stringify({
      person: { age: ADULT_AGE, type: "", "hair-color": [], "eye-color": [1, 2] },
      mood: { mood: "calm" },
      gaps: { missingItems: [], missingCategories: [] },
    })
    expect(run([text])).toEqual([{ field: "person.age", value: ADULT_AGE }])
  })

  it("reports each field once, even if the model repeats a key", () => {
    expect(run([`{"person":{"age":"${ADULT_AGE}","age":"${MINOR_AGE}"}}`])).toEqual([
      { field: "person.age", value: ADULT_AGE },
    ])
  })

  it("stops quietly on malformed input", () => {
    expect(run([`{"person":{"age":"${ADULT_AGE}",`, '"type" "x"', ',"hair-color":["a"]}}'])).toEqual([
      { field: "person.age", value: ADULT_AGE },
    ])
  })
})

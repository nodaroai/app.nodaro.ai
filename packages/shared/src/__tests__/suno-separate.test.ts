import { describe, it, expect } from "vitest"
import {
  SUNO_SEPARATE_TYPES,
  SUNO_STEM_NAMES,
  DEFAULT_SUNO_STEM_NAME,
  SUNO_SEPARATE_STEM_FIELDS,
  SUNO_SEPARATE_TAKE_FIELDS,
  SUNO_SEPARATE_RESULT_FIELDS,
  SUNO_SEPARATE_META_FIELDS,
  sunoSeparateCreditId,
  sunoSeparateHandleUrl,
  sunoSeparatePrimaryUrl,
} from "../entries/models.js"

describe("sunoSeparateCreditId", () => {
  it.each([
    ["separate_vocal", "suno-separate"], ["split_stem", "suno-separate-stem"],
    ["split_stem_advanced", "suno-separate-single"], [undefined, "suno-separate"], ["junk", "suno-separate"],
  ])("%s → %s", (t, id) => expect(sunoSeparateCreditId(t)).toBe(id))
})

it("SUNO_STEM_NAMES is KIE's 98-value enum", () => {
  expect(SUNO_STEM_NAMES).toHaveLength(98)
  expect(new Set(SUNO_STEM_NAMES).size).toBe(98)
  expect(SUNO_STEM_NAMES[0]).toBe("Lead Vocal")
  expect(SUNO_STEM_NAMES[SUNO_STEM_NAMES.length - 1]).toBe("Didgeridoo")
  expect(SUNO_STEM_NAMES).toContain("808")
  expect(SUNO_STEM_NAMES).toContain(DEFAULT_SUNO_STEM_NAME)
})

it("the three separation modes", () => {
  expect(SUNO_SEPARATE_TYPES).toEqual(["separate_vocal", "split_stem", "split_stem_advanced"])
})

it("result-field lists", () => {
  expect(SUNO_SEPARATE_STEM_FIELDS).toEqual([
    "vocalUrl", "instrumentalUrl", "backingVocalsUrl", "drumsUrl",
    "bassUrl", "guitarUrl", "pianoUrl", "keyboardUrl",
    "percussionUrl", "stringsUrl", "synthUrl", "fxUrl",
    "brassUrl", "woodwindsUrl", "otherUrl",
  ])
  expect(SUNO_SEPARATE_TAKE_FIELDS).toEqual(["isolatedUrl", "withoutUrl", "isolated2Url", "without2Url"])
  expect(SUNO_SEPARATE_RESULT_FIELDS).toEqual([...SUNO_SEPARATE_STEM_FIELDS, ...SUNO_SEPARATE_TAKE_FIELDS])
  expect(SUNO_SEPARATE_META_FIELDS).toEqual(["separateType", "stemName", "engineUsed", "sunoRefused", "fallbackReason"])
})

describe("sunoSeparateHandleUrl", () => {
  const legacy = { audioUrl: "A" }
  const vocalOnly = { audioUrl: "V", vocalUrl: "V" }
  const stems = { audioUrl: "V", vocalUrl: "V", drumsUrl: "D" }
  const single = { audioUrl: "I", isolatedUrl: "I", withoutUrl: "W", isolated2Url: "I2" }
  it("legacy shape (no per-field urls) still routes audioUrl", () => {
    expect(sunoSeparateHandleUrl(legacy, "vocals")).toBe("A")
    expect(sunoSeparateHandleUrl(legacy, "instrumental")).toBe("A")
  })
  it("a stem that did not come back is empty", () => {
    expect(sunoSeparateHandleUrl(stems, "instrumental")).toBeUndefined()
    expect(sunoSeparateHandleUrl(vocalOnly, "instrumental")).toBeUndefined()
  })
  it("one-instrument mode", () => {
    expect(sunoSeparateHandleUrl(single, "vocals")).toBeUndefined()
    expect(sunoSeparateHandleUrl(single, "instrumental")).toBeUndefined()
    expect(sunoSeparateHandleUrl(single, "isolated")).toBe("I")
    expect(sunoSeparateHandleUrl(single, "without")).toBe("W")
  })
  it("legacy handle spellings", () => {
    expect(sunoSeparateHandleUrl(stems, "vocal-out")).toBe("V")
    expect(sunoSeparateHandleUrl({ ...stems, instrumentalUrl: "N" }, "instrumental-out")).toBe("N")
  })
  it("no handle → primary", () => expect(sunoSeparateHandleUrl(single, null)).toBe("I"))
})

it("sunoSeparatePrimaryUrl", () => {
  expect(sunoSeparatePrimaryUrl({ vocalUrl: "V", instrumentalUrl: "N" })).toBe("V")
  expect(sunoSeparatePrimaryUrl({ instrumentalUrl: "N" })).toBe("N")
  expect(sunoSeparatePrimaryUrl({ isolatedUrl: "I", withoutUrl: "W" })).toBe("I")
  expect(sunoSeparatePrimaryUrl({ drumsUrl: "D" })).toBe("D")
})

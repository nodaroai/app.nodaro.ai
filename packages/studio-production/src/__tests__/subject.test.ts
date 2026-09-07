import { describe, it, expect } from "vitest"
import {
  PROMPT_HINT_SEPARATOR,
  SUBJECT_KEYS,
  SUBJECT_IMAGE_HINT_MODE_DEFAULT,
  SUBJECT_VIDEO_HINT_MODE_DEFAULT,
  getPersonDimensionLimit,
  renderSubjectHints,
  subjectFieldsForSurface,
} from "@nodaro/prompts"

import {
  SUBJECT_IMAGE_HINT_MODE,
  SUBJECT_VIDEO_HINT_MODE,
  copySubjectSelection,
  subjectHints,
  subjectSelection,
  subjectWireFields,
} from "../subject"
import type { SubjectSelection } from "../subject-pickers"

/**
 * The SUBJECT channel (S6) — studio's Subject picker selection → the platform's
 * flat `subject` wire object, and back.
 *
 * ONE VOCABULARY, unlike the look: studio keys its Subject pickers by the
 * platform's own field names, so the projection is a WHITELIST, not a rename.
 * What is pinned here is everything a whitelist still has to get right — the
 * omit-when-empty rule the routes' structured-mode check depends on, surface
 * filtering through the fold ROW that reads a field, copy-on-write, and the fact
 * that the previews render the SERVER's fold rather than a second one.
 */

const SELECTION: SubjectSelection = {
  age: "age-30s",
  ethnicity: ["ethnicity-east-asian"],
}

describe("subjectWireFields — the projection", () => {
  it("passes studio's selection through as PLATFORM wire keys", () => {
    const wire = subjectWireFields(SELECTION, "image")
    expect(wire).toEqual({ age: "age-30s", ethnicity: ["ethnicity-east-asian"] })
    for (const k of Object.keys(wire ?? {})) expect(SUBJECT_KEYS).toContain(k)
  })

  it("is `undefined`, never `{}` — the structured-mode rule", () => {
    // An empty object is TRUTHY for the routes' structured-mode check, which
    // also relaxes the prompt to `.min(0)`. Same reason `directionWireFields`
    // returns undefined; the guard belongs on both channels.
    expect(subjectWireFields({}, "image")).toBeUndefined()
    expect(subjectWireFields({ age: "" }, "image")).toBeUndefined()
    expect(subjectWireFields({ ethnicity: [] }, "image")).toBeUndefined()
    expect(subjectWireFields({ ethnicity: [""] }, "image")).toBeUndefined()
  })

  it("drops a key the platform does not know, and keeps an unknown ID", () => {
    // Unknown KEY: dropped, so `jobs.input_data` stays in the platform's own
    // vocabulary. Unknown ID: kept, because every getter resolves a miss to ""
    // — inert is better than a 400 on a retired catalog entry.
    const wire = subjectWireFields(
      { notASubjectField: "x", age: "age-retired-yesterday" },
      "image",
    )
    expect(wire).toEqual({ age: "age-retired-yesterday" })
  })

  it("de-dupes a multi-pick array without truncating it", () => {
    // The per-dimension cap is the SERVER's (`normalizeSubjectFields`), so the
    // projection must not do a second, drifting slice of its own.
    const limit = getPersonDimensionLimit("ethnicity")
    const ids = Array.from({ length: limit + 2 }, (_, i) => `eth-${i}`)
    const wire = subjectWireFields({ ethnicity: [...ids, ids[0]] }, "image")
    expect(wire?.ethnicity).toEqual(ids)
  })

  it("never mutates or aliases the caller's selection", () => {
    const source: SubjectSelection = { ethnicity: ["eth-a"] }
    const wire = subjectWireFields(source, "image")
    expect(wire?.ethnicity).not.toBe(source.ethnicity)
    ;(wire?.ethnicity as string[]).push("eth-b")
    expect(source.ethnicity).toEqual(["eth-a"])
  })

  it("filters by SURFACE through the fold ROW that reads the field", () => {
    // The wire keys are FIELDS but the platform declares surfaces per fold ROW,
    // so "is this field on this stage" has to go through the row that reads it.
    // Every row is `surface: "both"` today, which is exactly why the assertion
    // is the DERIVATION rather than the current table: the two projections agree
    // iff the two row sets do, so a row the platform later marks image-only
    // fails here instead of silently shipping on the video wire.
    const rows = (s: "image" | "video") =>
      subjectFieldsForSurface(s).map((r) => r.key)
    const full: SubjectSelection = {
      ...SELECTION,
      heldProp: "held-prop-anything",
      material: "material-anything",
      animal: "animal-anything",
    }
    expect(rows("video")).toEqual(rows("image"))
    expect(subjectWireFields(full, "video")).toEqual(
      subjectWireFields(full, "image"),
    )
    // The prop rows are one key each, so their surface is directly observable.
    for (const key of ["heldProp", "material", "animal"]) {
      expect(rows("image"), key).toContain(key)
      expect(Object.keys(subjectWireFields(full, "image") ?? {})).toContain(key)
    }
  })
})

describe("subjectHints — the previews render the SERVER's fold", () => {
  it("is the platform renderer, at the platform's own per-stage verbosity", () => {
    const wire = subjectWireFields(SELECTION, "image")!
    expect(subjectHints(wire, "image")).toEqual(
      renderSubjectHints(wire, {
        surface: "image",
        mode: SUBJECT_IMAGE_HINT_MODE_DEFAULT,
      }),
    )
    expect(subjectHints(wire, "video")).toEqual(
      renderSubjectHints(wire, {
        surface: "video",
        mode: SUBJECT_VIDEO_HINT_MODE_DEFAULT,
      }),
    )
  })

  it("DEFINES its verbosity as the platform's, never a copy of the value", () => {
    expect(SUBJECT_IMAGE_HINT_MODE).toBe(SUBJECT_IMAGE_HINT_MODE_DEFAULT)
    expect(SUBJECT_VIDEO_HINT_MODE).toBe(SUBJECT_VIDEO_HINT_MODE_DEFAULT)
    // …and the two stages really do differ, or the split is decoration.
    expect(SUBJECT_IMAGE_HINT_MODE).not.toBe(SUBJECT_VIDEO_HINT_MODE)
  })

  it("folds person as ONE comma-joined clause, not N `. `-joined fragments", () => {
    // The reason the subject channel is a SERVER fold rather than a client one:
    // thirty person fragments through the platform's `". "` hint join would read
    // "a beautiful woman. in her 30s. East Asian."
    const wire = subjectWireFields(
      { age: "age-30s", ethnicity: ["ethnicity-east-asian"] },
      "image",
    )
    const hints = subjectHints(wire, "image")
    expect(hints).toHaveLength(1)
    expect(hints[0]).not.toContain(PROMPT_HINT_SEPARATOR)
  })

  it("renders nothing for an empty projection", () => {
    expect(subjectHints(undefined, "image")).toEqual([])
    expect(subjectHints(undefined, "video")).toEqual([])
  })
})

describe("subjectSelection — the restore direction", () => {
  it("round-trips a projection back into the picker selection", () => {
    const wire = subjectWireFields(SELECTION, "image")
    expect(subjectSelection(wire)).toEqual(SELECTION)
  })

  it("drops the one field studio has no picker for", () => {
    // `customAge` is the platform's only NUMBER field; studio never sets it, and
    // re-arming it would put a value in the selection nothing can render.
    expect(subjectSelection({ age: "age-custom", customAge: 34 })).toEqual({
      age: "age-custom",
    })
  })

  it("is empty for an absent echo, and never aliases the echo's arrays", () => {
    expect(subjectSelection(undefined)).toEqual({})
    const echoed = { ethnicity: ["eth-a"] }
    const restored = subjectSelection(echoed)
    expect(restored.ethnicity).not.toBe(echoed.ethnicity)
  })
})

describe("copySubjectSelection", () => {
  it("copies a multi-pick dimension's array rather than aliasing it", () => {
    const source = { type: "woman", ethnicity: ["asian-any", "east-asian"] }
    const copy = copySubjectSelection(source)
    expect(copy).toEqual(source)
    expect(copy).not.toBe(source)
    expect(copy.ethnicity).not.toBe(source.ethnicity)
  })
})

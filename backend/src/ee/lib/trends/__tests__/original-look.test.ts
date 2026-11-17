/**
 * An optional person's original look at publish (`optional_person_default_missing`).
 *
 * What must hold:
 *  - an optional PERSON with no `defaultImages` blocks the publish, on every
 *    clip preparation (masking off, faces hidden, full depth, keep people),
 *    with the people's keys in `slots` and their names in the message;
 *  - an optional location, product or pet never does, with or without one;
 *  - a required person never does (it always has the runner's pictures);
 *  - a trend that hides its original is exempt (it keeps filling from Example 1);
 *  - the schema still takes the draft without one (saving is never held).
 */
import { describe, expect, it } from "vitest"
import { optionalPeopleWithoutOriginalLook, publishBlockers } from "../publish-check.js"
import { trendVersionDataSchema } from "../schemas.js"
import type { TrendSlot, TrendVersionData } from "../types.js"

const img = (n: string) => `https://cdn.example/trends/t1/${n}.png`
const CODE = "optional_person_default_missing"

const PREPARATIONS: ReadonlyArray<[string, TrendVersionData["faceMasking"]]> = [
  ["masking off", undefined],
  ["faces hidden", { mode: "always", threshold: 0.4 }],
  ["full depth", { mode: "always", source: "full-depth" }],
  ["keep people", { mode: "always", source: "keep-people" }],
]

const slot = (key: string, kind: TrendSlot["kind"], required: boolean, defaultImages?: string[]): TrendSlot =>
  ({ key, kind, label: { en: key.toUpperCase() }, required, roleName: `the ${key}`, ...(defaultImages ? { defaultImages } : {}) }) as TrendSlot

function data(slots: TrendSlot[], over: Partial<TrendVersionData> = {}): TrendVersionData {
  return {
    name: { en: "Dance" },
    source: {
      videoUrl: img("src"),
      durationSec: 12,
      display: { videoUrl: img("display"), posterUrl: img("poster"), width: 240, height: 320, durationSec: 12 },
    },
    previewStart: null,
    slots,
    references: [],
    examples: [],
    ...over,
  }
}

/** This blocker alone (the others, e.g. a missing face mask, are not this test's). */
const lookBlockers = (d: TrendVersionData) => publishBlockers(d, [], []).filter((b) => b.code === CODE)

describe("optional_person_default_missing", () => {
  it.each(PREPARATIONS)("an optional person with no original look blocks the publish (%s)", (_name, faceMasking) => {
    const d = data([slot("lead", "person", true), slot("guest", "person", false), slot("kid", "person", false)], faceMasking ? { faceMasking } : {})
    expect(lookBlockers(d)).toEqual([
      { code: CODE, slots: ["guest", "kid"], message: expect.stringMatching(/"GUEST", "KID"/) },
    ])
  })

  it.each(PREPARATIONS)("an optional person with one publishes (%s)", (_name, faceMasking) => {
    const d = data([slot("lead", "person", true), slot("guest", "person", false, [img("guest")])], faceMasking ? { faceMasking } : {})
    expect(lookBlockers(d)).toEqual([])
  })

  it("names only the people who lack one", () => {
    const d = data([slot("lead", "person", true), slot("guest", "person", false, [img("guest")]), slot("kid", "person", false)])
    expect(lookBlockers(d).map((b) => b.slots)).toEqual([["kid"]])
  })

  it.each(["location", "product", "pet"] as const)("an optional %s never needs one", (kind) => {
    expect(lookBlockers(data([slot("lead", "person", true), slot("other", kind, false)]))).toEqual([])
    expect(lookBlockers(data([slot("lead", "person", true), slot("other", kind, false, [img("other")])]))).toEqual([])
  })

  it("a required person never needs one", () => {
    expect(lookBlockers(data([slot("lead", "person", true), slot("second", "person", true)]))).toEqual([])
  })

  it.each(PREPARATIONS)("a trend that hides its original is exempt (%s)", (_name, faceMasking) => {
    const d = data([slot("lead", "person", true), slot("guest", "person", false)], { hideOriginal: true, ...(faceMasking ? { faceMasking } : {}) })
    expect(lookBlockers(d)).toEqual([])
    expect(optionalPeopleWithoutOriginalLook(d)).toEqual([])
    // Shown again, the same person blocks.
    expect(lookBlockers({ ...d, hideOriginal: false })).toHaveLength(1)
  })

  it("is a publish check only: the draft still validates (a save is never held)", () => {
    const d = data([slot("lead", "person", true), slot("guest", "person", false)])
    expect(trendVersionDataSchema.safeParse(d).success).toBe(true)
  })
})

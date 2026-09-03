import { describe, it, expect } from "vitest"
import { PEOPLE } from "../person.js"
import { STYLINGS } from "../styling.js"
import { POSES } from "../pose.js"
import { PICKER_CATALOGS } from "../picker-catalogs.js"
import { RETIRED_ADULT_ONLY_HINT_STRINGS } from "../age-floor.js"

/**
 * W1-b — spec 2026-09-01-app-reports-triage-design.md §3.3, wording approved
 * by §10 decisions 1 and 6.
 *
 * 12 adult `generate-character` prompts were refused by the provider's safety
 * filter because stacked picker fragments read as sexualized. The principle:
 * describe the garment or the look, not exposed skin; drop
 * "wet / sheen / exposed / bare / hugging / soft breath"; keep the attribute
 * renderable.
 *
 * SCOPE RULING (replay-harness verdict, internal validation results,
 * 2026-09-02): the go/no-go
 * criterion failed for TWO entries — `eye-state-half-lidded` and
 * `feature-collarbone-visible` rendered their attribute 0/10 and 0/22 times
 * under either wording, so their approved rewording could not be validated.
 * Both are LEFT AS-IS (promptHint, term, adultOnly all unchanged) and are
 * deliberately absent from PERSON_EXPECTED below. Their old wording remains
 * live in the catalog on purpose, which is why the RATCHET test at the
 * bottom exempts those two old strings from the "no retired string survives"
 * check — they are simultaneously live (kept) and retired (permanently in
 * the minor-age floor's strip set), which is harmless double coverage.
 *
 * This file pins BOTH fields of every reworded entry — `promptHint` (verbose
 * mode) and `term` (compact mode) — because a rephrase that touched only one
 * of them would leave the old wording reachable through the other. The last
 * test is the ratchet: no retired string (other than the two kept
 * exemptions above) may reappear anywhere in the catalog corpus.
 */

interface Expected {
  readonly id: string
  readonly promptHint: string
  readonly term: string
}

const PERSON_EXPECTED: ReadonlyArray<Expected> = [
  { id: "bust-very-full", promptHint: "a fuller bust", term: "fuller bust" },
  { id: "silhouette-hourglass", promptHint: "an hourglass figure", term: "hourglass figure" },
  { id: "waist-defined", promptHint: "a defined waistline", term: "defined waistline" },
  { id: "lip-state-glossy", promptHint: "with a glossy lip finish", term: "glossy lips" },
  { id: "lip-state-parted", promptHint: "with lips relaxed and slightly open, as if mid-sentence", term: "lips slightly open" },
  { id: "lip-state-bitten", promptHint: "lightly biting the lower lip", term: "biting lower lip" },
  { id: "eye-state-staring-camera", promptHint: "looking directly into the camera", term: "direct gaze to camera" },
  { id: "texture-dewy", promptHint: "with dewy, luminous skin", term: "dewy skin" },
  { id: "texture-glistening", promptHint: "with a light glistening sheen on the skin", term: "glistening sheen" },
  { id: "texture-baby-soft", promptHint: "with soft, fine-pored skin", term: "soft fine-pored skin" },
  { id: "texture-shower-fresh-wet", promptHint: "with fresh, water-dappled skin as if just out of the shower", term: "water-dappled skin" },
  { id: "feature-bare-shoulders", promptHint: "with the shoulders uncovered", term: "shoulders uncovered" },
  { id: "feature-midriff-visible", promptHint: "with a cropped hemline", term: "cropped hemline" },
]

const STYLING_EXPECTED: ReadonlyArray<Expected> = [
  { id: "state-fitted", promptHint: "tailored, close-fitting clothing", term: "close-fitting clothing" },
  { id: "state-wet", promptHint: "the clothing soaked through and dripping", term: "soaked clothing" },
]

const POSE_EXPECTED: ReadonlyArray<Expected> = [
  { id: "biting-lip", promptHint: "lightly biting the lower lip, a subtle playful expression", term: "biting lower lip" },
]

/** The two entries the harness ruled out of scope — their OLD wording is
 *  deliberately still live, so the RATCHET test below must not flag it. */
const KEPT_OLD_STRINGS: ReadonlySet<string> = new Set([
  "with heavy half-lidded sleepy eyes", // eye-state-half-lidded
  "half-lidded sleepy eyes",
  "with a prominent collarbone clearly defined and catching the light", // feature-collarbone-visible
  "visible collarbone",
])

function check(catalog: ReadonlyArray<{ id: string; promptHint: string; term?: string }>, expected: ReadonlyArray<Expected>) {
  for (const want of expected) {
    const entry = catalog.find((e) => e.id === want.id)
    expect(entry, `missing entry ${want.id}`).toBeDefined()
    expect(entry!.promptHint, `${want.id}.promptHint`).toBe(want.promptHint)
    expect(entry!.term, `${want.id}.term (authored, not label-derived)`).toBe(want.term)
  }
}

describe("W1-b rephrase — the 15 reworded entries plus the pose twin", () => {
  it("person entries carry the approved promptHint and term", () => {
    check(PEOPLE, PERSON_EXPECTED)
  })

  it("eye-state-half-lidded and feature-collarbone-visible are UNCHANGED (scope ruling)", () => {
    const halfLidded = PEOPLE.find((e) => e.id === "eye-state-half-lidded")
    expect(halfLidded?.promptHint).toBe("with heavy half-lidded sleepy eyes")
    expect(halfLidded?.term).toBe("half-lidded sleepy eyes")
    expect(halfLidded?.adultOnly).toBe(true)

    const collarbone = PEOPLE.find((e) => e.id === "feature-collarbone-visible")
    expect(collarbone?.promptHint).toBe("with a prominent collarbone clearly defined and catching the light")
    expect(collarbone?.term).toBe("visible collarbone")
    expect(collarbone?.adultOnly).toBe(true)
  })

  it("styling entries carry the approved promptHint and term", () => {
    check(STYLINGS, STYLING_EXPECTED)
  })

  it("the pose twin of lip-state-bitten is reworded to match", () => {
    check(POSES, POSE_EXPECTED)
  })

  it("all 16 ids are covered — the count is deliberate, not incidental", () => {
    expect(PERSON_EXPECTED.length + STYLING_EXPECTED.length + POSE_EXPECTED.length).toBe(16)
  })

  it("RATCHET: no retired string survives anywhere in the catalog corpus (except the 2 kept exemptions)", () => {
    const offenders: string[] = []
    for (const cat of PICKER_CATALOGS) {
      const options = [...(cat.options ?? []), ...(cat.dimensions ?? []).flatMap((d) => d.options)]
      for (const o of options) {
        for (const retired of RETIRED_ADULT_ONLY_HINT_STRINGS) {
          if (KEPT_OLD_STRINGS.has(retired)) continue
          // The fold literal is not an entry field; it is pinned separately in
          // person-exposure-hints.test.ts.
          if (o.promptHint === retired || o.term === retired) {
            offenders.push(`${cat.catalogId} • ${o.id} • "${retired}"`)
          }
        }
      }
    }
    expect(offenders, `retired wording is still live:\n${offenders.join("\n")}`).toEqual([])
  })
})

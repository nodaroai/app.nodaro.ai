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
 * SCOPE RULING, LATER RESOLVED (replay-harness verdict, internal validation
 * results, 2026-09-02): the go/no-go criterion initially failed for TWO
 * entries — `eye-state-half-lidded` and `feature-collarbone-visible`
 * rendered their attribute 0/10 and 0/22 times under either wording, so
 * their approved rewording could not be validated at the time and both
 * shipped byte-identical in the original W1-b PR. A follow-up replay on
 * staging found wordings that DO render, approved 2026-09-03. Both are now
 * included in PERSON_EXPECTED below with BOTH `promptHint` and `term`
 * reworded, like every other entry — the compact-mode term is not left
 * carrying the old wording.
 *
 * This file pins BOTH fields of every reworded entry — `promptHint` (verbose
 * mode) and `term` (compact mode) — because a rephrase that touched only one
 * of them would leave the old wording reachable through the other. The last
 * test is the ratchet: no retired string may reappear anywhere in the
 * catalog corpus.
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
  { id: "eye-state-half-lidded", promptHint: "with drowsy, partly closed eyes, the lids sitting low over the iris", term: "drowsy, partly closed eyes" },
  { id: "texture-dewy", promptHint: "with dewy, luminous skin", term: "dewy skin" },
  { id: "texture-glistening", promptHint: "with a light glistening sheen on the skin", term: "glistening sheen" },
  { id: "texture-baby-soft", promptHint: "with soft, fine-pored skin", term: "soft fine-pored skin" },
  { id: "texture-shower-fresh-wet", promptHint: "with fresh, water-dappled skin as if just out of the shower", term: "water-dappled skin" },
  { id: "feature-bare-shoulders", promptHint: "with the shoulders uncovered", term: "shoulders uncovered" },
  { id: "feature-collarbone-visible", promptHint: "with an open neckline that leaves the collarbones uncovered", term: "open neckline, collarbones uncovered" },
  { id: "feature-midriff-visible", promptHint: "with a cropped hemline", term: "cropped hemline" },
]

const STYLING_EXPECTED: ReadonlyArray<Expected> = [
  { id: "state-fitted", promptHint: "tailored, close-fitting clothing", term: "close-fitting clothing" },
  { id: "state-wet", promptHint: "the clothing soaked through and dripping", term: "soaked clothing" },
]

const POSE_EXPECTED: ReadonlyArray<Expected> = [
  { id: "biting-lip", promptHint: "lightly biting the lower lip, a subtle playful expression", term: "biting lower lip" },
]

function check(catalog: ReadonlyArray<{ id: string; promptHint: string; term?: string }>, expected: ReadonlyArray<Expected>) {
  for (const want of expected) {
    const entry = catalog.find((e) => e.id === want.id)
    expect(entry, `missing entry ${want.id}`).toBeDefined()
    expect(entry!.promptHint, `${want.id}.promptHint`).toBe(want.promptHint)
    expect(entry!.term, `${want.id}.term (authored, not label-derived)`).toBe(want.term)
  }
}

describe("W1-b rephrase — the 17 reworded entries plus the pose twin", () => {
  it("person entries carry the approved promptHint and term", () => {
    check(PEOPLE, PERSON_EXPECTED)
  })

  it("eye-state-half-lidded and feature-collarbone-visible keep adultOnly through the rework", () => {
    const halfLidded = PEOPLE.find((e) => e.id === "eye-state-half-lidded")
    expect(halfLidded?.adultOnly).toBe(true)

    const collarbone = PEOPLE.find((e) => e.id === "feature-collarbone-visible")
    expect(collarbone?.adultOnly).toBe(true)
  })

  it("styling entries carry the approved promptHint and term", () => {
    check(STYLINGS, STYLING_EXPECTED)
  })

  it("the pose twin of lip-state-bitten is reworded to match", () => {
    check(POSES, POSE_EXPECTED)
  })

  it("all 18 ids are covered — the count is deliberate, not incidental", () => {
    expect(PERSON_EXPECTED.length + STYLING_EXPECTED.length + POSE_EXPECTED.length).toBe(18)
  })

  it("RATCHET: no retired string survives anywhere in the catalog corpus", () => {
    const offenders: string[] = []
    for (const cat of PICKER_CATALOGS) {
      const options = [...(cat.options ?? []), ...(cat.dimensions ?? []).flatMap((d) => d.options)]
      for (const o of options) {
        for (const retired of RETIRED_ADULT_ONLY_HINT_STRINGS) {
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

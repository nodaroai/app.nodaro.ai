/**
 * The animal hint/term getters live in `@nodaro/shared` (`animals.ts`) rather
 * than here, for one hard reason: `catalog-funnel-ratchet.test.ts` derives its
 * watch set from `picker-catalogs.ts`'s uppercase value imports — `ANIMALS`
 * included — scans all of `packages/prompts/src`, and its allowlist can only
 * SHRINK. A getter under `prompts/src` that read `ANIMALS` would be a new
 * offender. Putting them where the catalog lives keeps the funnel honest.
 *
 * That placement costs one thing: `@nodaro/prompts` depends on
 * `@nodaro/shared`, never the reverse, so `getAnimalTerm` cannot call this
 * package's `deriveTerm` and carries a local copy of the four-line derivation.
 * THIS FILE IS THE PIN on that copy — it is the only place that can import both
 * sides. If it fails, the copy in `shared/animals.ts` has drifted from
 * `term.ts`'s `deriveTerm` and must be brought back, not "fixed" by editing the
 * expectation.
 *
 * It also pins the two repointed call sites (the picker-catalog funnel's
 * synthesized `promptHint` and `getParameterPromptHint`'s `animal` case)
 * against the getters, so the phrasing keeps ONE owner.
 */
import { describe, it, expect } from "vitest"
import { ANIMALS, getAnimalPromptHint, getAnimalTerm } from "@nodaro/shared"
import { deriveTerm } from "../term.js"
import { PICKER_CATALOGS } from "../picker-catalogs.js"
import { getParameterPromptHint } from "../parameter-prompt-hint.js"

const animalCatalog = PICKER_CATALOGS.find((c) => c.nodeType === "animal")

describe("animal getters", () => {
  it("phrases the full hint as 'featuring a {label}, {description}'", () => {
    const a = ANIMALS[0]!
    expect(getAnimalPromptHint(a.id)).toBe(
      `featuring a ${a.label.toLowerCase()}, ${a.description}`,
    )
  })

  it("returns '' for an unknown, empty, undefined or null id (never throws)", () => {
    for (const id of ["__no_such_animal__", "", undefined, null]) {
      expect(getAnimalPromptHint(id)).toBe("")
      expect(getAnimalTerm(id)).toBe("")
    }
  })

  it("derives every term exactly as `deriveTerm` would (the cross-package copy pin)", () => {
    for (const a of ANIMALS) {
      expect(getAnimalTerm(a.id), a.id).toBe(a.term ?? deriveTerm(a.label))
    }
  })

  it("gives every catalog entry a non-empty hint and term", () => {
    for (const a of ANIMALS) {
      expect(getAnimalPromptHint(a.id).length, a.id).toBeGreaterThan(0)
      expect(getAnimalTerm(a.id).length, a.id).toBeGreaterThan(0)
    }
  })
})

describe("both repointed call sites read the getters", () => {
  it("the picker-catalog funnel synthesizes every animal option from `getAnimalPromptHint`", () => {
    expect(animalCatalog?.options?.length).toBe(ANIMALS.length)
    for (const opt of animalCatalog!.options!) {
      expect(opt.promptHint, opt.id).toBe(getAnimalPromptHint(opt.id))
      expect(opt.term, opt.id).toBe(getAnimalTerm(opt.id))
    }
  })

  it("`getParameterPromptHint` renders an animal node through the getters, per mode", () => {
    const a = ANIMALS[0]!
    expect(getParameterPromptHint({ id: "n1", type: "animal", data: { animal: a.id } })).toBe(
      getAnimalPromptHint(a.id),
    )
    expect(
      getParameterPromptHint({ id: "n1", type: "animal", data: { animal: a.id, hintMode: "compact" } }),
    ).toBe(getAnimalTerm(a.id))
  })

  it("an animal node with an unknown id contributes nothing", () => {
    expect(
      getParameterPromptHint({ id: "n1", type: "animal", data: { animal: "__no_such_animal__" } }),
    ).toBe("")
  })
})

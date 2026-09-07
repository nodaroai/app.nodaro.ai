import { describe, it, expect } from "vitest"
import {
  ANIMALS,
} from "@nodaro/shared"
import {
  PEOPLE,
  PERSON_DIMENSION_ORDER,
  PERSON_FIELD_BY_DIMENSION,
  buildPersonHints,
  getPersonDimensionLimit,
  STYLINGS,
  STYLING_DIMENSION_ORDER,
  STYLING_FIELD_BY_DIMENSION,
  buildStylingHints,
  getStylingDimensionLimit,
  type PersonDimension,
} from "@nodaro/prompts"

import {
  PERSON_PICKER,
  STYLING_PICKER,
  SUBJECT_MULTIDIM,
  PROP_PICKERS,
  personHints,
  subjectCreationHints,
} from "../subject-pickers"

/**
 * The rich, multi-dimensional Person picker is assembled from the public catalog
 * exports (the platform recipe). These invariants catch a mis-assembly LOUDLY: a
 * dropped dimension, an empty option list, a category missing from a dimension's
 * sub-group order (which would silently hide options), or a fold that diverges
 * from the official `buildPersonHints`.
 */

describe("PERSON_PICKER — multi-dimensional registry integrity", () => {
  it("surfaces every Nodaro Person dimension exactly once", () => {
    const fields = PERSON_PICKER.sections.flatMap((s) =>
      s.dimensions.map((d) => d.field),
    )
    expect(fields.length).toBe(PERSON_DIMENSION_ORDER.length)
    expect(new Set(fields).size).toBe(fields.length)
  })

  it("every dimension has a non-empty option catalog and a label", () => {
    for (const s of PERSON_PICKER.sections) {
      for (const d of s.dimensions) {
        expect(d.pill.catalog.length, `${d.field} options`).toBeGreaterThan(0)
        expect(d.label, `${d.field} label`).toBeTruthy()
      }
    }
  })

  it("folds a selection into the official rich clauses (byte-identical)", () => {
    const type = PEOPLE.find((p) => p.dimension === "type")!
    const value = { type: type.id }
    const hints = personHints(value, "full")
    expect(hints.length).toBeGreaterThan(0)
    // We ARE the official builder — never a divergent re-implementation.
    expect(hints).toEqual(buildPersonHints(value as never))
  })

  it("composes multiple dimensions in canonical order", () => {
    const type = PEOPLE.find((p) => p.dimension === "type")!
    // Any OTHER dimension carrying a non-neutral option → a second clause to
    // compose. Picked from the catalog (not a hardcoded axis) so a future
    // dimension rename/split never silently breaks this integrity check.
    const other = PEOPLE.find((p) => p.dimension !== "type" && p.promptHint)!
    const hints = personHints(
      {
        [PERSON_FIELD_BY_DIMENSION[type.dimension]]: type.id,
        [PERSON_FIELD_BY_DIMENSION[other.dimension]]: other.id,
      },
      "full",
    )
    expect(hints.length).toBeGreaterThanOrEqual(2)
  })

  it("empty selection folds to nothing", () => {
    expect(personHints({}, "full")).toEqual([])
  })

  it("grouped dimensions cover every option's sub-group in their order", () => {
    for (const s of PERSON_PICKER.sections) {
      for (const d of s.dimensions) {
        const cats = d.pill.categories
        if (!cats) continue
        const order = new Set(cats.order)
        for (const e of d.pill.catalog) {
          expect(
            order.has(cats.categoryOf(e)),
            `${d.field}: sub-group "${cats.categoryOf(e)}" missing from order`,
          ).toBe(true)
        }
      }
    }
  })
})

describe("Subject builders — Person + Styling + props", () => {
  it("SUBJECT_MULTIDIM surfaces Person and Styling", () => {
    expect(SUBJECT_MULTIDIM.map((p) => p.key)).toEqual(["person", "styling"])
  })

  it("Styling surfaces its dimensions with non-empty options", () => {
    for (const s of STYLING_PICKER.sections) {
      for (const d of s.dimensions) {
        expect(d.pill.catalog.length, d.field).toBeGreaterThan(0)
      }
    }
  })

  it("folds a Styling selection via the official buildStylingHints", () => {
    const makeup = STYLINGS.find((s) => s.dimension === "makeup")!
    const value = { makeup: makeup.id }
    expect(subjectCreationHints(value, "full")).toEqual(buildStylingHints(value as never))
  })

  it("Person + Styling fold over the same map without cross-contamination", () => {
    const type = PEOPLE.find((p) => p.dimension === "type")!
    const makeup = STYLINGS.find((s) => s.dimension === "makeup")!
    // Person reads only person fields; Styling only styling fields → both compose.
    const hints = subjectCreationHints({ type: type.id, makeup: makeup.id }, "full")
    expect(hints).toContain(buildPersonHints({ type: type.id } as never)[0])
    expect(hints).toContain(buildStylingHints({ makeup: makeup.id } as never)[0])
  })
})

describe("PROP_PICKERS — single-pick scene props", () => {
  it("surfaces Held Prop, Material and Animal", () => {
    expect(PROP_PICKERS.map((p) => p.pill.key)).toEqual([
      "heldProp",
      "material",
      "animal",
    ])
  })

  it("every prop has a non-empty catalog and yields a hint for its first option", () => {
    for (const p of PROP_PICKERS) {
      expect(p.pill.catalog.length, p.pill.key).toBeGreaterThan(0)
      expect(
        p.getHint(p.pill.catalog[0].id).length,
        `${p.pill.key} hint`,
      ).toBeGreaterThan(0)
    }
  })

  it("subjectCreationHints composes props alongside Person", () => {
    const animal = ANIMALS[0]
    const hints = subjectCreationHints({ animal: animal.id }, "full")
    expect(hints.length).toBeGreaterThan(0)
  })
})

/**
 * The facial-geometry layer (platform PR #3356) — nine new Face dimensions that
 * ride in through the DATA-DRIVEN PERSON_DIMENSION_SECTIONS grouping with no
 * studio edit beyond a re-vendor. The integrity block above already guards "every
 * dimension exactly once" (so a stale hardcoded section or a lingering `lips`
 * would fail there). This pins the facial-geometry contract specifically: the
 * dims render + are single-pick, the legacy combined `lips` is gone, the
 * studio-owned multi-pick caps survive, and a neutral pick injects NOTHING.
 */
const GEOMETRY_DIMS: ReadonlyArray<PersonDimension> = [
  "cheekbones",
  "facial-fullness",
  "eyelid-type",
  "canthal-tilt",
  "eye-spacing",
  "eye-set-brow",
  "nose-tip",
  "lip-fullness",
  "lip-shape",
]

describe("Person facial-geometry layer", () => {
  const dimByField = new Map(
    PERSON_PICKER.sections.flatMap((s) => s.dimensions).map((d) => [d.field, d]),
  )

  it("renders every facial-geometry dimension as single-pick with options", () => {
    for (const dim of GEOMETRY_DIMS) {
      const rendered = dimByField.get(PERSON_FIELD_BY_DIMENSION[dim])
      expect(rendered, `${dim} should render`).toBeTruthy()
      expect(rendered!.pill.catalog.length, `${dim} options`).toBeGreaterThan(0)
      expect(rendered!.multi ?? false, `${dim} single-pick`).toBe(false)
    }
  })

  it("drops the deprecated combined `lips`, keeping lip-fullness + lip-shape", () => {
    const fields = [...dimByField.keys()]
    expect(fields).not.toContain("lips")
    expect(fields).toContain("lipFullness")
    expect(fields).toContain("lipShape")
  })

  it("folds each option to exactly its promptHint — neutral (empty hint) injects nothing", () => {
    for (const dim of GEOMETRY_DIMS) {
      const field = PERSON_FIELD_BY_DIMENSION[dim]
      for (const opt of PEOPLE.filter((p) => p.dimension === dim)) {
        const hints = subjectCreationHints({ [field]: opt.id }, "full")
        expect(hints, opt.id).toEqual(opt.promptHint ? [opt.promptHint] : [])
      }
    }
  })

  it("reads EVERY multi-pick cap off the platform registry, never a local table", () => {
    // There used to be a hand-written cap table here mirroring one in the source,
    // and it had drifted (studio capped `wardrobe-state` at 2 where the registry
    // says 3). Asserting the derivation for every dimension — rather than a
    // second copy of the numbers — is what makes that class of bug unreachable.
    for (const dim of PERSON_DIMENSION_ORDER) {
      const limit = getPersonDimensionLimit(dim)
      const rendered = dimByField.get(PERSON_FIELD_BY_DIMENSION[dim])!
      expect(rendered.maxPicks, dim).toBe(limit > 1 ? limit : undefined)
      expect(rendered.multi, dim).toBe(limit > 1 ? true : undefined)
    }
    // The guard is only a guard if the registry actually declares multi-pick
    // dimensions (a registry of all-1s would make every assertion vacuous).
    expect(
      PERSON_DIMENSION_ORDER.filter((d) => getPersonDimensionLimit(d) > 1).length,
    ).toBeGreaterThan(0)
  })
})

/**
 * STYLING's sections are studio's own UI grouping (the platform ships no
 * `STYLING_DIMENSION_SECTIONS` twin), so the guard is on the RECONCILIATION:
 * every dimension the catalog declares is reachable exactly once, and nothing
 * the catalog dropped is still rendered.
 */
describe("STYLING_PICKER — sections reconcile with the platform's dimension list", () => {
  it("renders every STYLING_DIMENSION_ORDER dimension exactly once", () => {
    const fields = STYLING_PICKER.sections.flatMap((s) =>
      s.dimensions.map((d) => d.field),
    )
    expect([...fields].sort()).toEqual(
      [...STYLING_DIMENSION_ORDER.map((d) => STYLING_FIELD_BY_DIMENSION[d])].sort(),
    )
    expect(new Set(fields).size).toBe(fields.length)
  })

  it("reads every styling cap off the platform registry too", () => {
    const dimByField = new Map(
      STYLING_PICKER.sections.flatMap((s) => s.dimensions).map((d) => [d.field, d]),
    )
    for (const dim of STYLING_DIMENSION_ORDER) {
      const limit = getStylingDimensionLimit(dim)
      const rendered = dimByField.get(STYLING_FIELD_BY_DIMENSION[dim])!
      expect(rendered.maxPicks, dim).toBe(limit > 1 ? limit : undefined)
    }
  })
})

/**
 * The person body-axes split (platform `feat(person): split body into six
 * independent proportion axes`) — the two coarse, overlapping Build + Body-
 * Proportions pickers became SIX independent single-select axes, so bodies the
 * old model couldn't express (e.g. a slim frame WITH a full bust — mutually
 * exclusive values of the one old Build field) now are. They ride in through the
 * DATA-DRIVEN PERSON_DIMENSION_SECTIONS grouping with no studio edit beyond a
 * re-vendor; "Photo to structure" detects them automatically via the shared
 * picker-analyzer schema. This pins the contract: the six render single-pick, the
 * retired Build + Body-Proportions are gone, and a neutral value injects NOTHING.
 */
const BODY_AXES: ReadonlyArray<PersonDimension> = [
  "frame",
  "body-mass",
  "bust",
  "waist",
  "hips",
  "silhouette",
]

describe("Person body-axes split", () => {
  const dimByField = new Map(
    PERSON_PICKER.sections.flatMap((s) => s.dimensions).map((d) => [d.field, d]),
  )

  it("renders all six body axes as single-pick with options", () => {
    for (const dim of BODY_AXES) {
      const rendered = dimByField.get(PERSON_FIELD_BY_DIMENSION[dim])
      expect(rendered, `${dim} should render`).toBeTruthy()
      expect(rendered!.pill.catalog.length, `${dim} options`).toBeGreaterThan(0)
      expect(rendered!.multi ?? false, `${dim} single-pick`).toBe(false)
    }
  })

  it("retires the coarse Build + Body-Proportions axes", () => {
    const dims = new Set<string>(PEOPLE.map((p) => p.dimension))
    expect(dims.has("build")).toBe(false)
    expect(dims.has("body-proportions")).toBe(false)
  })

  it("folds each option to exactly its promptHint — neutral injects nothing", () => {
    for (const dim of BODY_AXES) {
      const field = PERSON_FIELD_BY_DIMENSION[dim]
      for (const opt of PEOPLE.filter((p) => p.dimension === dim)) {
        const hints = subjectCreationHints({ [field]: opt.id }, "full")
        expect(hints, opt.id).toEqual(opt.promptHint ? [opt.promptHint] : [])
      }
    }
  })
})

/**
 * Subject folds FULL at every studio call site today (a subject is description,
 * not an instruction), so the contract worth pinning is twofold: "full" must be
 * byte-identical to the platform builders — the pre-hint-mode behaviour — and
 * the compact lever must actually WORK, so the day a compact subject surface
 * appears it is a one-word edit at the call site rather than a dead argument.
 */
describe("subject folds — verbosity lever", () => {
  it("every prop picker wires a term that is neither empty nor its own hint", () => {
    for (const p of PROP_PICKERS) {
      const first = p.pill.catalog[0]
      expect(p.getTerm(first.id).length, `${p.pill.key} term`).toBeGreaterThan(0)
      expect(p.getTerm(first.id), `${p.pill.key} term === hint`).not.toBe(
        p.getHint(first.id),
      )
    }
  })

  it('"full" stays byte-identical to the platform builder', () => {
    const type = PEOPLE.find((p) => p.dimension === "type")!
    const value = { type: type.id }
    expect(personHints(value, "full")).toEqual(buildPersonHints(value as never))
  })

  it('"compact" reaches the platform builders and the props alike', () => {
    const type = PEOPLE.find((p) => p.dimension === "type")!
    const value = { type: type.id }
    expect(personHints(value, "compact")).toEqual(
      buildPersonHints(value as never, "compact"),
    )
    // Props: the Animal fold goes through the unified dispatcher, so its compact
    // form must be the bare species — not the "featuring a …" clause.
    const animal = ANIMALS[0]
    const full = subjectCreationHints({ animal: animal.id }, "full")
    const compact = subjectCreationHints({ animal: animal.id }, "compact")
    expect(compact).not.toEqual(full)
    expect(compact[0].length).toBeLessThan(full[0].length)
  })

  it("a cleared selection injects nothing in either mode", () => {
    expect(subjectCreationHints({}, "full")).toEqual([])
    expect(subjectCreationHints({}, "compact")).toEqual([])
  })
})

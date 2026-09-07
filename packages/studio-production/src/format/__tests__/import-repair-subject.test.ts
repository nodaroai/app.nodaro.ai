import { describe, it, expect } from "vitest"

import { buildFormatRegistry } from "../registry"
import { repairDocument } from "../import"
import {
  FORMAT_ID,
  FORMAT_VERSION,
  type ProductionDocument,
  type SceneDocument,
} from "../schema"
import { videoDurationOptions } from "../../model-menu"

/**
 * Stage 3's LOOK and SUBJECT repairs (spec §6.3) — the look-map id gate (D2,
 * including the film key every scene agrees on) and `frame.subject` (D9), the
 * areas `import-repair-subject.ts` itself owns. Split out of
 * `import-repair.test.ts` (G2's own R40-style split, taken in the follow-ups
 * fix wave) once that file passed the 800-line house cap.
 *
 * Repair is CATALOG-AWARE and NEVER REJECTS: a file written against a newer
 * catalog, or by a model that invented an id, opens with what this studio
 * understands and a warning for the rest.
 *
 * Each of the three files carries its OWN copy of the tiny local builders
 * (`doc`/`document`, `REGISTRY`, `durationsFor`) rather than importing them
 * from a sibling: importing a `.test.ts` file would re-run its `describe`/`it`
 * blocks a second time — the same standalone-with-local-fixtures precedent
 * `production-bundle.recipe.test.ts` set. Every `describe` below is a PURE
 * MOVE: not a line of a case changed.
 */

const REGISTRY = buildFormatRegistry()
const durationsFor = (model: string) =>
  videoDurationOptions(model).map((d) => d.value)

const doc = (over: Partial<ProductionDocument> = {}): ProductionDocument => ({
  format: FORMAT_ID,
  version: 1,
  scenes: [{ frame: { prompt: "an alley" } }],
  ...over,
})

// A second, narrower builder for the tests that destructure `{ doc, warnings }`
// off `repairDocument`'s result, which would shadow the `doc(...)` factory
// above if it were reused in the same statement.
const document = (scenes: ReadonlyArray<SceneDocument>): ProductionDocument => ({
  format: FORMAT_ID,
  version: FORMAT_VERSION,
  scenes: [...scenes],
})

const codes = (d: ProductionDocument) =>
  repairDocument(d, REGISTRY, durationsFor).warnings.map((w) => w.code)

describe("repair — look layers", () => {
  it("drops a key no picker owns", () => {
    const out = repairDocument(
      doc({ scenes: [{ look: { vibeId: "moody" }, frame: { prompt: "p" } }] }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings[0].code).toBe("unknown-key")
    expect(out.warnings[0].path).toBe("scenes[0].look.vibeId")
    expect(out.doc.scenes[0].look).toBeUndefined()
  })

  it("drops an id the picker does not carry", () => {
    const out = repairDocument(
      doc({ scenes: [{ look: { atmosphereId: "space-dust" }, frame: { prompt: "p" } }] }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings[0].code).toBe("unknown-id")
    expect(out.doc.scenes[0].look).toBeUndefined()
  })

  it("migrates a retired id instead of dropping it", () => {
    const out = repairDocument(
      doc({ scenes: [{ look: { framingId: "head-to-knees" }, frame: { prompt: "p" } }] }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings).toEqual([])
    expect(out.doc.scenes[0].look).toEqual({ framingId: "medium-wide-shot" })
  })

  it("drops a film key the film layer does not own", () => {
    const out = repairDocument(
      doc({ film: { "lighting-time-of-day": "golden-hour" } }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings[0].code).toBe("layer")
    expect(out.doc.film).toBeUndefined()
  })

  it("keeps the film keys the film layer owns", () => {
    const out = repairDocument(
      doc({ film: { cameraFormatId: "arri-alexa", colorLookId: "teal-orange" } }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings).toEqual([])
    expect(out.doc.film).toEqual({
      cameraFormatId: "arri-alexa",
      colorLookId: "teal-orange",
    })
  })

  it("drops Camera Movement from a scene look — it is the motion lever", () => {
    expect(
      codes(
        doc({
          scenes: [{ look: { cameraMotionId: "tracking-shot" }, frame: { prompt: "p" } }],
        }),
      ),
    ).toEqual(["layer"])
  })

  it("drops Character FX from picks — it is its own node", () => {
    expect(
      codes(
        doc({
          scenes: [
            { shots: [{ seconds: 4, text: "t", picks: { characterFxId: "werewolf" } }] },
          ],
        }),
      ),
    ).toEqual(["layer"])
  })
})

describe("repair — subject (D9)", () => {
  it("repairs a subject map: unknown field / id dropped, multi capped, single settled", () => {
    const hair = REGISTRY.subject.find((d) => d.field === "hairColor")!.options[0].id
    const { doc, warnings } = repairDocument(
      document([
        { frame: { prompt: "x", subject: { hairColor: [hair, "nope"], eyebrowsX: "y" } } },
      ]),
      REGISTRY,
      durationsFor,
    )
    // "nope" drops (unknown-id), leaving hairColor's one survivor SETTLED to a
    // bare id — a multi dimension's `SubjectFields` field legally holds either
    // shape (platform: `hairColor?: string | ReadonlyArray<string>`), so an
    // array of one is never the repaired shape. `eyebrowsX` names no dimension
    // this studio's registry carries at all (unknown-key).
    expect(doc.scenes[0].frame?.subject).toEqual({ hairColor: hair })
    expect(warnings.map((w) => w.code).sort()).toEqual(["unknown-id", "unknown-key"])
  })

  it("caps a multi dimension at its own maxPicks, keeping the array shape", () => {
    const dim = REGISTRY.subject.find((d) => d.field === "hairColor")!
    const ids = dim.options.slice(0, 3).map((o) => o.id)
    const { doc, warnings } = repairDocument(
      document([{ frame: { prompt: "x", subject: { hairColor: ids } } }]),
      REGISTRY,
      durationsFor,
    )
    expect(doc.scenes[0].frame?.subject).toEqual({
      hairColor: ids.slice(0, dim.maxPicks),
    })
    expect(warnings.map((w) => w.code)).toEqual(["cardinality"])
  })

  it("settles a single-pick dimension given an array to its first valid id", () => {
    const dim = REGISTRY.subject.find((d) => !d.multi)!
    const ids = dim.options.slice(0, 2).map((o) => o.id)
    const { doc, warnings } = repairDocument(
      document([{ frame: { prompt: "x", subject: { [dim.field]: ids } } }]),
      REGISTRY,
      durationsFor,
    )
    expect(doc.scenes[0].frame?.subject).toEqual({ [dim.field]: ids[0] })
    expect(warnings.map((w) => w.code)).toEqual(["cardinality"])
  })

  it("drops the whole key when every id in it is unknown", () => {
    const dim = REGISTRY.subject.find((d) => d.field === "hairColor")!
    const out = repairDocument(
      document([{ frame: { prompt: "x", subject: { [dim.field]: "nope" } } }]),
      REGISTRY,
      durationsFor,
    )
    expect(out.doc.scenes[0].frame?.subject).toBeUndefined()
    expect(out.warnings.map((w) => w.code)).toEqual(["unknown-id"])
  })

  it("drops an empty subject map to no key at all", () => {
    const out = repairDocument(
      document([{ frame: { prompt: "x", subject: {} } }]),
      REGISTRY,
      durationsFor,
    )
    expect(out.doc.scenes[0].frame?.subject).toBeUndefined()
    expect(out.warnings).toEqual([])
  })

  it("never mutates the document it was given", () => {
    const hair = REGISTRY.subject.find((d) => d.field === "hairColor")!.options[0].id
    const input = document([
      { frame: { prompt: "x", subject: { hairColor: [hair, "nope"] } } },
    ])
    repairDocument(input, REGISTRY, durationsFor)
    expect(input.scenes[0].frame?.subject).toEqual({ hairColor: [hair, "nope"] })
  })
})

describe("repair — a film key every scene agrees on is the film's (D2)", () => {
  const scene = (look: Record<string, string>) => ({ look, frame: { prompt: "x" } })
  it("moves a unanimous key into film and warns once", () => {
    const { doc, warnings } = repairDocument(
      { format: FORMAT_ID, version: FORMAT_VERSION, scenes: [scene({ styleId: "anime", framingId: "medium-wide-shot" }), scene({ styleId: "anime" })] },
      REGISTRY, durationsFor,
    )
    expect(doc.film).toEqual({ styleId: "anime" })
    expect(doc.scenes[0].look).toEqual({ framingId: "medium-wide-shot" })
    expect(doc.scenes[1].look).toBeUndefined()
    expect(warnings.filter((w) => w.code === "layer")).toEqual([
      { code: "layer", message: "Style was set on every scene — moved to the film look.", path: "scenes[0].look.styleId" },
    ])
  })
  it("leaves a single scene alone, and a split vote alone", () => {
    expect(repairDocument({ format: FORMAT_ID, version: FORMAT_VERSION, scenes: [scene({ styleId: "anime" })] }, REGISTRY, durationsFor).doc.film).toBeUndefined()
    const split = repairDocument({ format: FORMAT_ID, version: FORMAT_VERSION, scenes: [scene({ styleId: "anime" }), scene({ styleId: "noir" })] }, REGISTRY, durationsFor)
    expect(split.doc.film).toBeUndefined()
    expect(split.doc.scenes[0].look).toEqual({ styleId: "anime" })
  })
  it("never overrides a film key the document already sets", () => {
    const { doc } = repairDocument({ format: FORMAT_ID, version: FORMAT_VERSION, film: { styleId: "noir" }, scenes: [scene({ styleId: "anime" }), scene({ styleId: "anime" })] }, REGISTRY, durationsFor)
    expect(doc.film).toEqual({ styleId: "noir" })
    expect(doc.scenes[0].look).toEqual({ styleId: "anime" })
  })
})

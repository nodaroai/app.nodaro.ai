import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, MODEL_MAKERS, isModelMakerId, modelMakerOf, type ModelCatalogEntry, type ModelCatalogEntryFields } from "../model-catalog.js"

/**
 * Every catalog model names the company that made it (`maker`), served on
 * `GET /v1/models` as `maker: { id, name }` and used to pick the maker's mark
 * (`logoUrl`) — unless it is marked `ownLabel: true` (offered under the
 * deployment's own label, decided 2026-11-11), which names none and may carry
 * none. `ModelCatalogEntry` requires exactly one of the two, so a new model
 * without either does not compile; these cases also cover entries built at run
 * time and keep the registry and the catalog in step.
 */

/** What is wrong with who each entry is offered under: no maker and no `ownLabel`, an unknown maker, or a maker on an own-label model. */
function offeredUnderProblems(entries: ReadonlyArray<{ id: string; maker?: unknown; ownLabel?: unknown }>): string[] {
  return entries.flatMap((m) => {
    if (m.ownLabel === true) return m.maker === undefined ? [] : [`${m.id}: marked ownLabel but names maker ${String(m.maker)}`]
    if (m.ownLabel !== undefined) return [`${m.id}: ownLabel must be true or absent, not ${String(m.ownLabel)}`]
    return isModelMakerId(m.maker) ? [] : [`${m.id}: names no maker from the registry (${String(m.maker)})`]
  })
}

describe("model makers", () => {
  it("every catalog model names a maker from the registry, unless it is offered under the deployment's own label", () => {
    expect(offeredUnderProblems(Object.values(MODEL_CATALOG))).toEqual([])
  })

  it("the guard refuses a model with no maker that is not marked ownLabel", () => {
    expect(offeredUnderProblems([{ id: "x" }])).toEqual(["x: names no maker from the registry (undefined)"])
    expect(offeredUnderProblems([{ id: "x", maker: "acme" }])).toEqual(["x: names no maker from the registry (acme)"])
    expect(offeredUnderProblems([{ id: "x", ownLabel: false }])).toEqual(["x: ownLabel must be true or absent, not false"])
  })

  it("the guard refuses a model marked ownLabel that names a maker", () => {
    expect(offeredUnderProblems([{ id: "x", ownLabel: true, maker: "google" }])).toEqual(["x: marked ownLabel but names maker google"])
    expect(offeredUnderProblems([{ id: "x", ownLabel: true }])).toEqual([])
  })

  it("the type requires exactly one of maker and ownLabel", () => {
    const fields = {} as ModelCatalogEntryFields
    const withMaker: ModelCatalogEntry = { ...fields, maker: "google" }
    const ownLabel: ModelCatalogEntry = { ...fields, ownLabel: true }
    // @ts-expect-error — neither
    const neither: ModelCatalogEntry = { ...fields }
    // @ts-expect-error — both
    const both: ModelCatalogEntry = { ...fields, ownLabel: true, maker: "google" }
    expect([withMaker, ownLabel, neither, both]).toHaveLength(4)
  })

  // `series` is the product line ("Kling", "Flux") — required on every entry,
  // including the ones the Models tab does not list, so every model can be
  // filtered by its line.
  it("every catalog entry has a non-empty series", () => {
    const missing = Object.values(MODEL_CATALOG)
      .filter((m) => typeof m.series !== "string" || !m.series.trim())
      .map((m) => m.id)
    expect(missing).toEqual([])
  })

  it("every registered maker makes at least one catalog model", () => {
    const used = new Set<string>(Object.values(MODEL_CATALOG).flatMap((m) => (m.maker === undefined ? [] : [m.maker])))
    expect(Object.keys(MODEL_MAKERS).filter((id) => !used.has(id))).toEqual([])
  })

  it("maker ids are lowercase slugs, and every maker has a name", () => {
    for (const [id, maker] of Object.entries(MODEL_MAKERS)) {
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(maker.name.trim().length, id).toBeGreaterThan(0)
    }
  })

  it("all the models of one family come from one maker", () => {
    // `family` is the vendor / lab grouping clients filter on; a family whose
    // models name two makers is almost always a copied entry that kept the
    // other company's maker. An own-label model counts as its own "maker", so
    // a family is never half own-label.
    const makersByFamily = new Map<string, Set<string>>()
    for (const m of Object.values(MODEL_CATALOG)) {
      const makers = makersByFamily.get(m.family) ?? new Set<string>()
      makers.add(m.maker ?? "(own label)")
      makersByFamily.set(m.family, makers)
    }
    const split = [...makersByFamily]
      .filter(([, makers]) => makers.size > 1)
      .map(([family, makers]) => `${family}: ${[...makers].join(", ")}`)
    expect(split).toEqual([])
  })

  it("a family named after a lab, a product line or a cloud brand resolves to the company behind it", () => {
    expect(MODEL_CATALOG["z-image"]!.maker).toBe("alibaba") // Tongyi-MAI (Alibaba's Tongyi Lab)
    expect(MODEL_CATALOG["happyhorse"]!.maker).toBe("alibaba")
    expect(MODEL_CATALOG["video-depth-anything"]!.maker).toBe("bytedance")
    expect(MODEL_CATALOG["depth-anything-frames"]!.maker).toBe("bytedance")
    expect(MODEL_CATALOG["volcengine-lipsync"]!.maker).toBe("bytedance") // Volcano Engine
    expect(MODEL_CATALOG["infinitalk"]!.maker).toBe("meituan") // MeiGen-AI
  })

  it("modelMakerOf serves the maker's id and the company's name", () => {
    expect(modelMakerOf(MODEL_CATALOG["veo3"]!)).toEqual({ id: "google", name: "Google" })
    expect(modelMakerOf(MODEL_CATALOG["flux"]!)).toEqual({ id: "black-forest-labs", name: "Black Forest Labs" })
    expect(modelMakerOf(MODEL_CATALOG["seedance-2"]!)).toEqual({ id: "bytedance", name: "ByteDance" })
  })

  it("modelMakerOf serves no maker for a model offered under the deployment's own label", () => {
    expect(modelMakerOf({ ownLabel: true })).toBeUndefined()
    // Even one built at run time (or by a JavaScript caller) that also names a maker.
    expect(modelMakerOf({ ownLabel: true, maker: "google" } as unknown as Pick<ModelCatalogEntry, "maker" | "ownLabel">)).toBeUndefined()
  })

  it("modelMakerOf never throws: an entry built at run time without a known maker has none", () => {
    expect(modelMakerOf({ maker: "acme" as never })).toBeUndefined()
    expect(modelMakerOf({ maker: undefined as never })).toBeUndefined()
    expect(modelMakerOf({ maker: "toString" as never })).toBeUndefined()
  })

  it("isModelMakerId accepts only the registry's own ids", () => {
    expect(isModelMakerId("google")).toBe(true)
    expect(isModelMakerId("Google")).toBe(false)
    expect(isModelMakerId("toString")).toBe(false)
    expect(isModelMakerId("")).toBe(false)
    expect(isModelMakerId(42)).toBe(false)
    expect(isModelMakerId(undefined)).toBe(false)
  })
})

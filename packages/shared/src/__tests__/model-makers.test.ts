import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, MODEL_MAKERS, isModelMakerId, modelMakerOf } from "../model-catalog.js"

/**
 * Every catalog model names the company that made it (`maker`), served on
 * `GET /v1/models` as `maker: { id, name }` and used to pick the maker's mark
 * (`logoUrl`). The field is required on `ModelCatalogEntry`, so a new model
 * without one does not compile; these cases also cover entries built at run
 * time and keep the registry and the catalog in step.
 */
describe("model makers", () => {
  it("every catalog model names a maker from the registry", () => {
    const unknown = Object.values(MODEL_CATALOG)
      .filter((m) => !isModelMakerId(m.maker))
      .map((m) => `${m.id}: ${String(m.maker)}`)
    expect(unknown).toEqual([])
  })

  it("every registered maker makes at least one catalog model", () => {
    const used = new Set<string>(Object.values(MODEL_CATALOG).map((m) => m.maker))
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
    // other company's maker.
    const makersByFamily = new Map<string, Set<string>>()
    for (const m of Object.values(MODEL_CATALOG)) {
      const makers = makersByFamily.get(m.family) ?? new Set<string>()
      makers.add(m.maker)
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

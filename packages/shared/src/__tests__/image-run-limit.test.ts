/**
 * What happens to images past a model's limit, by how the run was asked for
 * (`refusesImagesOverLimitOn`, decided 2026-11-14):
 *
 * - a request (the API, MCP, the editor's Run of one node) is refused on every
 *   model with a request image limit of its own, saying how many to remove;
 * - a workflow run is refused only on a model whose catalog entry carries
 *   `refusesImagesOverLimit` (FLUX 3 Klein), and every other model's workflow
 *   run keeps its documented trim, so a saved graph keeps running;
 * - a model held to the default request limit is trimmed on both, as before.
 *
 * Read from the data (`requestImageLimit`'s table and the catalog flag), never
 * from a list of ids, so a model that gains a request limit is covered.
 */
import { describe, expect, it } from "vitest"
import { MODEL_CATALOG } from "../model-catalog.js"
import {
  DEFAULT_REQUEST_IMAGE_LIMIT,
  hasOwnRequestImageLimit,
  imageReferenceLimit,
  refusesImagesOverLimit,
  refusesImagesOverLimitOn,
  requestImageLimit,
} from "../model-constants.js"

/** Request-limited models whose workflow runs keep their trim: both ids each. */
const TRIMMED_IN_WORKFLOWS = [
  "seedream-5-5",
  "seedream-5-5-i2i",
  "gpt-image-2-6-flare",
  "gpt-image-2-6-flare-i2i",
  "gpt-image-2-6-sunburst",
  "gpt-image-2-6-sunburst-i2i",
  "minimax-h3-image",
  "minimax-h3-image-i2i",
]
const REFUSED_EVERYWHERE = ["flux-3-klein", "flux-3-klein-i2i"]
/** Held to the default request limit: trimmed at their reference limit on every run. */
const UNCHANGED = ["nano-banana-pro", "flux-2-pro", "gpt-image-2-6-economy-i2i", "seedream-5-flash-i2i"]

const imageModels = Object.values(MODEL_CATALOG).filter((m) => m.kind === "image")

describe("a request over a model's image limit", () => {
  it.each(TRIMMED_IN_WORKFLOWS)("%s refuses a request and keeps a workflow run's trim", (id) => {
    expect(hasOwnRequestImageLimit(id)).toBe(true)
    expect(refusesImagesOverLimitOn(id, "request")).toBe(true)
    expect(refusesImagesOverLimitOn(id, "workflow")).toBe(false)
  })

  it.each(REFUSED_EVERYWHERE)("%s refuses a request and a workflow run alike", (id) => {
    expect(refusesImagesOverLimitOn(id, "request")).toBe(true)
    expect(refusesImagesOverLimitOn(id, "workflow")).toBe(true)
  })

  it.each(UNCHANGED)("%s, with no request limit of its own, is refused on neither", (id) => {
    expect(hasOwnRequestImageLimit(id)).toBe(false)
    expect(requestImageLimit(id)).toBe(DEFAULT_REQUEST_IMAGE_LIMIT)
    expect(refusesImagesOverLimitOn(id, "request")).toBe(false)
    expect(refusesImagesOverLimitOn(id, "workflow")).toBe(false)
  })

  it("names no model it does not know", () => {
    expect(hasOwnRequestImageLimit(undefined)).toBe(false)
    expect(hasOwnRequestImageLimit("not-a-model")).toBe(false)
    expect(refusesImagesOverLimitOn(undefined, "request")).toBe(false)
  })
})

describe("the rule, read from the data for every image model", () => {
  it("a request is refused exactly where the model has a request limit of its own or the catalog flag", () => {
    for (const m of imageModels) {
      expect(refusesImagesOverLimitOn(m.id, "request"), m.id).toBe(hasOwnRequestImageLimit(m.id) || refusesImagesOverLimit(m.id))
    }
  })

  it("a workflow run is refused exactly where the catalog carries the flag", () => {
    for (const m of imageModels) {
      expect(refusesImagesOverLimitOn(m.id, "workflow"), m.id).toBe(m.refusesImagesOverLimit === true)
    }
  })

  it("a flagged model has a request limit of its own, so a workflow run and a request refuse the same count", () => {
    for (const m of imageModels.filter((x) => x.refusesImagesOverLimit === true)) {
      expect(hasOwnRequestImageLimit(m.id), m.id).toBe(true)
    }
  })

  it("a request-limited model's reference limit is its request limit, so a workflow run's trim stops at the count a request may send", () => {
    // The assembler trims a workflow run's references at `imageReferenceLimit`;
    // a request is refused past `requestImageLimit`. Were they to differ, a
    // workflow run would send a different number than a request may.
    const limited = imageModels.filter((m) => hasOwnRequestImageLimit(m.id))
    expect(limited.map((m) => m.id)).toEqual(expect.arrayContaining([...TRIMMED_IN_WORKFLOWS, ...REFUSED_EVERYWHERE]))
    for (const m of limited) expect(imageReferenceLimit(m.id), m.id).toBe(requestImageLimit(m.id))
  })
})

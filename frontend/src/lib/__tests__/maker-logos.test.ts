import { describe, it, expect } from "vitest"
import { getModel } from "@nodaro/shared/model-catalog"
import { modelMakerIdFor } from "../model-search"
import { makerLogoMap, type ModelMakersBody } from "../maker-logos"

describe("modelMakerIdFor", () => {
  it("reads the maker of a catalog id", () => {
    expect(modelMakerIdFor("flux")).toBe("black-forest-labs")
    expect(modelMakerIdFor("nano-banana-pro")).toBe("google")
  })

  it("resolves a picker variant id through its base id, like the company search", () => {
    // A suffixed id the catalog has no entry of its own for.
    expect(getModel("flux-t2v")).toBeUndefined()
    expect(modelMakerIdFor("flux-t2v")).toBe("black-forest-labs")
  })

  it("is undefined for an id the catalog does not know", () => {
    expect(modelMakerIdFor("not-a-model")).toBeUndefined()
  })
})

describe("makerLogoMap", () => {
  const body: ModelMakersBody = {
    makers: [
      { id: "openai", name: "OpenAI", logoUrl: "https://cdn/openai.svg?v=1" },
      { id: "meituan", name: "Meituan", logoUrl: null },
    ],
  }

  it("maps each maker to the mark the server publishes", () => {
    expect(makerLogoMap(body).get("openai")).toBe("https://cdn/openai.svg?v=1")
  })

  it("leaves out a maker with no published mark", () => {
    const map = makerLogoMap(body)
    expect(map.has("meituan")).toBe(false)
    expect(map.size).toBe(1)
  })

  it("reads an empty or malformed answer as no marks", () => {
    expect(makerLogoMap({} as ModelMakersBody).size).toBe(0)
  })
})

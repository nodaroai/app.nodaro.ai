import { describe, expect, it } from "vitest"
import { buildCreditModelIdentifier, resolveNormalizedImageGen } from "../credit-identifiers.js"
import { MODEL_CATALOG, normalizeModelInput } from "../model-catalog.js"
import { GPT_IMAGE_2_6_TIERED_I2I, GPT_IMAGE_2_6_TIERED_T2I, gptImage26EstimatedImages, gptImage26SentImages, isGptImage26AutoRun } from "../gpt-image-2-6.js"
import { countImageInputEdges } from "../node-refs.js"
import { IMAGE_I2I_PROVIDERS, IMAGE_GEN_PROVIDERS, T2I_TO_I2I_VARIANT } from "../model-constants.js"

const ALL = [
  "gpt-image-2-6-flare", "gpt-image-2-6-flare-i2i",
  "gpt-image-2-6-sunburst", "gpt-image-2-6-sunburst-i2i",
  "gpt-image-2-6-economy", "gpt-image-2-6-economy-i2i",
]

describe("GPT Image 2.6 price ids", () => {
  it("a text-to-image run is priced on quality and size", () => {
    expect(buildCreditModelIdentifier("gpt-image-2-6-flare", "low", "2K")).toBe("gpt-image-2-6-flare:low:2K")
    expect(buildCreditModelIdentifier("gpt-image-2-6-sunburst", "high", "4K", undefined, undefined, 0)).toBe("gpt-image-2-6-sunburst:high:4K")
  })

  it("no setting is the default, medium at 1K", () => {
    expect(buildCreditModelIdentifier("gpt-image-2-6-flare")).toBe("gpt-image-2-6-flare:medium:1K")
  })

  it("an edit is priced on its input images too, from one to sixteen", () => {
    const id = "gpt-image-2-6-flare-i2i"
    expect(buildCreditModelIdentifier(id, "medium", "1K", undefined, undefined, 3)).toBe(`${id}:medium:1K:3ref`)
    expect(buildCreditModelIdentifier(id, "medium", "1K", undefined, undefined, 0)).toBe(`${id}:medium:1K:1ref`)
    expect(buildCreditModelIdentifier(id, "medium", "1K", undefined, undefined, 40)).toBe(`${id}:medium:1K:16ref`)
  })

  it("a text-to-image id sent images is priced as the edit it runs as", () => {
    expect(buildCreditModelIdentifier("gpt-image-2-6-sunburst", "low", "1K", undefined, undefined, 2))
      .toBe("gpt-image-2-6-sunburst-i2i:low:1K:2ref")
  })

  it("a value off the grid lands on the default, never an id no row answers", () => {
    expect(buildCreditModelIdentifier("gpt-image-2-6-flare", "basic", "2 MP")).toBe("gpt-image-2-6-flare:medium:1K")
  })

  it("Economy is one flat id, whatever is sent", () => {
    expect(buildCreditModelIdentifier("gpt-image-2-6-economy", "high", "4K")).toBe("gpt-image-2-6-economy")
    expect(buildCreditModelIdentifier("gpt-image-2-6-economy-i2i", undefined, undefined, undefined, undefined, 5)).toBe("gpt-image-2-6-economy-i2i")
  })

  it("the route's resolver swaps to the edit model and prices its images", () => {
    const n = resolveNormalizedImageGen({ provider: "gpt-image-2-6-flare", quality: "high", resolution: "2K", refCount: 4, swapToI2i: true })
    expect(n.modelId).toBe("gpt-image-2-6-flare-i2i")
    expect(n.identifier).toBe("gpt-image-2-6-flare-i2i:high:2K:4ref")
  })
})

describe("GPT Image 2.6 catalog", () => {
  it.each(ALL)("%s is offered and is OpenAI's", (id) => {
    expect(MODEL_CATALOG[id]?.maker).toBe("openai")
    expect(MODEL_CATALOG[id]?.series).toBe("GPT Image")
    expect([...IMAGE_GEN_PROVIDERS, ...IMAGE_I2I_PROVIDERS] as string[]).toContain(id)
  })

  it("Flare and Sunburst take six qualities at 1K, 2K and 4K, medium by default", () => {
    for (const id of [...GPT_IMAGE_2_6_TIERED_T2I, ...GPT_IMAGE_2_6_TIERED_I2I]) {
      expect(MODEL_CATALOG[id]?.qualities).toEqual(["auto", "low", "medium", "high", "xhigh", "max"])
      expect(MODEL_CATALOG[id]?.defaultQuality).toBe("medium")
      expect(MODEL_CATALOG[id]?.resolutions).toEqual(["1K", "2K", "4K"])
    }
  })

  it("every quality has its own price id, Auto included", () => {
    expect(buildCreditModelIdentifier("gpt-image-2-6-flare", "auto", "2K")).toBe("gpt-image-2-6-flare:auto:2K")
    expect(buildCreditModelIdentifier("gpt-image-2-6-flare", "xhigh", "1K")).toBe("gpt-image-2-6-flare:xhigh:1K")
    expect(buildCreditModelIdentifier("gpt-image-2-6-sunburst-i2i", "max", "4K", undefined, undefined, 16)).toBe("gpt-image-2-6-sunburst-i2i:max:4K:16ref")
    expect(buildCreditModelIdentifier("gpt-image-2-6-flare-i2i", "auto", "1K", undefined, undefined, 2)).toBe("gpt-image-2-6-flare-i2i:auto:1K:2ref")
  })

  it("only Flare and Sunburst at Auto settle on KIE's bill", () => {
    expect(isGptImage26AutoRun("gpt-image-2-6-flare", "auto")).toBe(true)
    expect(isGptImage26AutoRun("gpt-image-2-6-sunburst-i2i", "auto")).toBe(true)
    expect(isGptImage26AutoRun("gpt-image-2-6-flare", "max")).toBe(false)
    expect(isGptImage26AutoRun("gpt-image-2-6-economy", "auto")).toBe(false)
    expect(isGptImage26AutoRun("gpt-image-2-5-flare", "auto")).toBe(false)
    expect(isGptImage26AutoRun(undefined, "auto")).toBe(false)
  })

  it.each(["auto", "xhigh", "max"])("a model without %s drops it", (quality) => {
    expect(normalizeModelInput("gpt-image-2-5-flare", { quality }).quality).toBeUndefined()
    expect(normalizeModelInput("gpt-image-2-6-economy", { quality }).quality).toBeUndefined()
  })

  it("the four ratios under trial are on Flare and Sunburst, not on Economy", () => {
    for (const id of [...GPT_IMAGE_2_6_TIERED_T2I, ...GPT_IMAGE_2_6_TIERED_I2I]) {
      expect(MODEL_CATALOG[id]?.aspectRatios).toEqual(expect.arrayContaining(["27:16", "16:27", "9:8", "8:9"]))
    }
    for (const id of ["gpt-image-2-6-economy", "gpt-image-2-6-economy-i2i"]) {
      expect(MODEL_CATALOG[id]?.aspectRatios).not.toContain("27:16")
    }
  })

  it("Economy has no quality or size setting", () => {
    expect(normalizeModelInput("gpt-image-2-6-economy", { quality: "high", resolution: "4K" }))
      .toMatchObject({ quality: undefined, resolution: undefined })
  })

  it("each text-to-image id has its edit sibling", () => {
    for (const flavour of ["flare", "sunburst", "economy"]) {
      expect(T2I_TO_I2I_VARIANT[`gpt-image-2-6-${flavour}`]).toBe(`gpt-image-2-6-${flavour}-i2i`)
    }
  })
})

describe("the background setting", () => {
  const WITH_BACKGROUND = [...ALL, "gpt-image-2", "gpt-image-2-i2i", "gpt-image-2-5-flare", "gpt-image-2-5-flare-i2i", "gpt-image-2-5-sunburst", "gpt-image-2-5-sunburst-i2i"]

  it.each(WITH_BACKGROUND)("%s offers auto, opaque and transparent", (id) => {
    expect(MODEL_CATALOG[id]?.backgrounds).toEqual(["auto", "opaque", "transparent"])
  })

  it("a model without the setting drops the value and says so", () => {
    const out = normalizeModelInput("nano-banana-pro", { background: "transparent" })
    expect(out.background).toBeUndefined()
    expect(out.adjustments).toEqual([expect.objectContaining({ field: "background", from: "transparent", to: undefined })])
  })

  it.each(["gpt-image-2-6-flare", "gpt-image-2-5-sunburst", "gpt-image-2"])("%s: transparent moves the size to 1K and says so", (id) => {
    const out = normalizeModelInput(id, { background: "transparent", resolution: "4K" })
    expect(out).toMatchObject({ background: "transparent", resolution: "1K" })
    expect(out.adjustments).toEqual([expect.objectContaining({ field: "resolution", from: "4K", to: "1K" })])
  })

  it("an opaque background keeps the size", () => {
    expect(normalizeModelInput("gpt-image-2-6-flare", { background: "opaque", resolution: "4K" }))
      .toMatchObject({ background: "opaque", resolution: "4K", adjustments: [] })
  })

  it("transparent with no size stays with no size (the model's 1K default)", () => {
    expect(normalizeModelInput("gpt-image-2-6-flare", { background: "transparent" }).resolution).toBeUndefined()
  })

  it("the price follows the size a transparent run renders at", () => {
    const n = resolveNormalizedImageGen({ provider: "gpt-image-2-6-flare", resolution: "4K", quality: "high", background: "transparent", refCount: 0 })
    expect(n.identifier).toBe("gpt-image-2-6-flare:high:1K")
    expect(n.background).toBe("transparent")
    const old = resolveNormalizedImageGen({ provider: "gpt-image-2-5-flare", resolution: "4K", background: "transparent", refCount: 0 })
    expect(old.identifier).toBe("gpt-image-2-5-flare")
  })
})

describe("GPT Image 2.6: the images a run sends", () => {
  const A = "https://a.png"
  const B = "https://b.png"

  it("a base image is one more image", () => {
    expect(gptImage26SentImages("gpt-image-2-6-flare", [], A)).toBe(1)
    expect(gptImage26SentImages("gpt-image-2-6-flare", [B], A)).toBe(2)
  })

  it("a base already among the references is not counted twice", () => {
    expect(gptImage26SentImages("gpt-image-2-6-flare", [A, B], A)).toBe(2)
  })

  it("no base, and any other model, is the references alone", () => {
    expect(gptImage26SentImages("gpt-image-2-6-flare", [A], undefined)).toBe(1)
    expect(gptImage26SentImages("flux-2-pro", [B], A)).toBe(1)
    expect(gptImage26SentImages(undefined, [B], A)).toBe(1)
  })

  it("an estimate counts every source of an image", () => {
    const data = { referenceImageUrls: [A], characterDefinitionIds: ["c1", "c2"], baseImageUrl: B }
    expect(gptImage26EstimatedImages("gpt-image-2-6-flare", data, 1)).toBe(5)
    expect(gptImage26EstimatedImages("gpt-image-2-6-flare-i2i", {}, 0)).toBe(1)
    expect(gptImage26EstimatedImages("gpt-image-2-6-flare", { sourceImageUrl: A }, 0)).toBe(1)
  })

  it("wires count reference images and identity nodes, for this node only", () => {
    const edges = [
      { target: "n", targetHandle: "references" },
      { target: "n", targetHandle: "assets" },
      { target: "n", targetHandle: "prompt" },
      { target: "other", targetHandle: "assets" },
    ]
    expect(countImageInputEdges(edges, "n")).toBe(2)
  })
})

describe("the background setting's size rule", () => {
  it("GPT Image 2 and 2.5: transparent above 1K moves to 1K", () => {
    for (const id of ["gpt-image-2", "gpt-image-2-i2i", "gpt-image-2-5-flare", "gpt-image-2-5-sunburst-i2i"]) {
      const r = normalizeModelInput(id, { resolution: "2K", background: "transparent" })
      expect(r.resolution, id).toBe("1K")
      expect(r.background, id).toBe("transparent")
    }
  })

  it("GPT Image 2 and 2.5: opaque above 1K is not sent, and says so", () => {
    const r = normalizeModelInput("gpt-image-2-5-flare", { resolution: "4K", background: "opaque" })
    expect(r.resolution).toBe("4K")
    expect(r.background).toBeUndefined()
    expect(r.adjustments.map((a) => a.field)).toContain("background")
  })

  it("GPT Image 2 and 2.5: auto above 1K is not sent, with nothing to say", () => {
    const r = normalizeModelInput("gpt-image-2", { resolution: "2K", background: "auto" })
    expect(r.background).toBeUndefined()
    expect(r.adjustments).toEqual([])
  })

  it("GPT Image 2 and 2.5: any value at 1K is sent", () => {
    expect(normalizeModelInput("gpt-image-2", { resolution: "1K", background: "opaque" }).background).toBe("opaque")
  })

  it("GPT Image 2.6: opaque and auto stay at any size, transparent moves to 1K", () => {
    expect(normalizeModelInput("gpt-image-2-6-flare", { resolution: "4K", background: "opaque" }).background).toBe("opaque")
    const r = normalizeModelInput("gpt-image-2-6-flare", { resolution: "4K", background: "transparent" })
    expect(r.resolution).toBe("1K")
    expect(r.background).toBe("transparent")
  })
})

describe("GPT Image 2.6 estimates and a moodboard", () => {
  it("counts the most pictures a moodboard can add, so a quote is never below the run", () => {
    expect(gptImage26EstimatedImages("gpt-image-2-6-flare", { direction: { style: "moodboard:abc" } }, 0)).toBe(12)
    expect(gptImage26EstimatedImages("gpt-image-2-6-flare", { direction: { style: ["moodboard:abc"] } }, 1)).toBe(13)
  })

  it("a catalog style or a palette adds no image", () => {
    expect(gptImage26EstimatedImages("gpt-image-2-6-flare", { direction: { style: "noir" } }, 0)).toBe(0)
    expect(gptImage26EstimatedImages("gpt-image-2-6-flare", { direction: { colorLook: "palette:abc" } }, 0)).toBe(0)
    expect(gptImage26EstimatedImages("gpt-image-2-6-flare", { direction: "moodboard:abc" }, 0)).toBe(0)
  })
})

describe("GPT Image 2.6 keeps Auto a choice", () => {
  it("a run with no quality renders at the default, and a value it does not take snaps there", () => {
    expect(MODEL_CATALOG["gpt-image-2-6-flare"]?.qualities?.[0]).toBe("auto")
    expect(normalizeModelInput("gpt-image-2-6-flare", { quality: "basic" }).quality).toBe("medium")
    expect(normalizeModelInput("gpt-image-2-6-sunburst", { quality: "turbo" }).quality).toBe("medium")
  })
})

import { describe, expect, it } from "vitest"
import { siteCaptureMaxStills, siteCaptureNodeOutputs, siteCapturePageUrl, siteCaptureStillUrls, siteCaptureStills } from "../site-capture-node.js"

const CAPTURE = {
  pageUrl: "https://example.com/",
  title: "Example",
  fullPage: { url: "https://cdn.example/full.jpg", width: 412, height: 6000, truncated: false },
  stills: [
    { index: 1, sectionOrder: 3, label: "Pricing", category: "pricing", url: "https://cdn.example/1.png" },
    { index: 0, sectionOrder: 0, label: "Hero", category: "hero", url: "https://cdn.example/0.png" },
    { index: 2, sectionOrder: 5, label: "Broken", category: "other", url: "" },
  ],
  facts: ["$12 per month"],
}

describe("siteCapturePageUrl — the page a run captures", () => {
  it("is the address typed on the node", () => expect(siteCapturePageUrl("  example.com/pricing ", "https://other.com")).toBe("example.com/pricing"))
  it("else the first web address in the wired text, without trailing punctuation", () =>
    expect(siteCapturePageUrl("", "Look at https://acme.io/pricing, then https://b.io.")).toBe("https://acme.io/pricing"))
  it("else the wired text's first word (the route normalises or refuses it)", () => expect(siteCapturePageUrl(undefined, "acme.io is the site")).toBe("acme.io"))
  it("else nothing", () => {
    expect(siteCapturePageUrl("", "   ")).toBe("")
    expect(siteCapturePageUrl(undefined, undefined)).toBe("")
  })
})

describe("siteCaptureMaxStills — the route's bounds", () => {
  it.each([
    [undefined, 8],
    ["5", 8],
    [Number.NaN, 8],
    [1, 3],
    [5.4, 5],
    [12, 8],
  ])("%j → %i", (value, stills) => expect(siteCaptureMaxStills(value)).toBe(stills))
})

describe("the capture's outputs", () => {
  it("lists the stills in page order and drops one with no address; the full page is never one of them", () => {
    expect(siteCaptureStills(CAPTURE).map((s) => s.label)).toEqual(["Hero", "Pricing"])
    expect(siteCaptureStillUrls(CAPTURE)).toEqual(["https://cdn.example/0.png", "https://cdn.example/1.png"])
  })

  it("hands on the capture as json, its first still as the image and every still as the list", () => {
    expect(siteCaptureNodeOutputs(CAPTURE)).toEqual({
      json: CAPTURE,
      imageUrl: "https://cdn.example/0.png",
      listResults: ["https://cdn.example/0.png", "https://cdn.example/1.png"],
    })
  })

  it("a capture with no still hands on its json only; anything that is not a capture hands on nothing", () => {
    expect(siteCaptureNodeOutputs({ ...CAPTURE, stills: [] })).toEqual({ json: { ...CAPTURE, stills: [] } })
    expect(siteCaptureNodeOutputs(null)).toEqual({})
    expect(siteCaptureNodeOutputs([CAPTURE])).toEqual({})
    expect(siteCaptureStills("nope")).toEqual([])
  })
})

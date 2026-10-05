import { describe, it, expect } from "vitest"
import { anyOutputIsPreview, outputIsPreview } from "../render-preview"

const take = (url: string, quality: "proxy" | "final") => ({ url, jobId: url, timestamp: "t", quality })

describe("outputIsPreview — an app output card's Preview label (A1b)", () => {
  it("reads a run's own output first: the render's quality, or the stamp of the card's url", () => {
    expect(outputIsPreview("apply-edl", {}, { videoUrl: "p.mp4", quality: "proxy" })).toBe(true)
    expect(outputIsPreview("apply-edl", { generatedResults: [take("p.mp4", "proxy")] }, { videoUrl: "f.mp4", quality: "final" })).toBe(false)
    const run = { listResults: ["a", "b"], listResultStamps: [{ quality: "final" }, { quality: "proxy" }] }
    expect(outputIsPreview("apply-edl", {}, run, "a")).toBe(false)
    expect(outputIsPreview("apply-edl", {}, run, "b")).toBe(true)
    expect(anyOutputIsPreview("apply-edl", {}, run, ["a", "b"])).toBe(true)
  })

  it("else the node's saved take — the selected result, or the card's url in its latest batch", () => {
    const data = { quality: "final", generatedResults: [take("p0", "proxy"), take("f0", "final")], activeResultIndex: 0, __listResults: ["p0"] }
    expect(outputIsPreview("apply-edl", data, undefined)).toBe(true)
    expect(outputIsPreview("apply-edl", { ...data, activeResultIndex: 1 }, undefined)).toBe(false)
    expect(outputIsPreview("apply-edl", data, undefined, "p0")).toBe(true)
  })

  it("a list that is the result history (no batch) labels each card by its own take", () => {
    // Three single proxy previews: no `__listResults`, so the card list is the
    // filtered history, and no row of a batch or a run names them.
    const data = { generatedResults: [take("p3", "proxy"), take("p2", "proxy"), take("p1", "proxy")] }
    for (const url of ["p3", "p2", "p1"]) expect(outputIsPreview("apply-edl", data, undefined, url)).toBe(true)
    expect(anyOutputIsPreview("apply-edl", data, undefined, ["p3", "p2", "p1"])).toBe(true)
    // A fullscreen run's output without stamps for those urls falls through to the saved take.
    expect(outputIsPreview("apply-edl", data, { videoUrl: "p3" }, "p2")).toBe(true)
  })

  it("the url decides, not the position — a filtered list never shifts a label onto its neighbour", () => {
    const data = { generatedResults: [take("f-new", "final"), take("p-old", "proxy")] }
    // The history filter dropped "f-new": the first card shows "p-old".
    expect(outputIsPreview("apply-edl", data, undefined, "p-old")).toBe(true)
    expect(outputIsPreview("apply-edl", data, undefined, "f-new")).toBe(false)
  })

  it("never for another node, or a node with nothing", () => {
    expect(outputIsPreview("generate-video", {}, { videoUrl: "v", quality: "proxy" })).toBe(false)
    expect(outputIsPreview("apply-edl", undefined, undefined)).toBe(false)
    expect(outputIsPreview("apply-edl", undefined, undefined, "x")).toBe(false)
  })
})

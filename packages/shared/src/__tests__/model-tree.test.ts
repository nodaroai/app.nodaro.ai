import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "../model-catalog.js"
import { modelToNodeTarget, buildModelTree, searchModelVariants } from "../model-tree.js"

describe("modelToNodeTarget", () => {
  it("maps an enum image model to generate-image with a provider preset", () => {
    expect(modelToNodeTarget("nano-banana")).toEqual({ nodeType: "generate-image", field: "provider", value: "nano-banana" })
  })
  it("maps suno ids to suno-generate via the model field with the catalog dataValue", () => {
    expect(modelToNodeTarget("suno")).toEqual({ nodeType: "suno-generate", field: "model", value: "V4" })
    expect(modelToNodeTarget("suno-v5")).toEqual({ nodeType: "suno-generate", field: "model", value: "V5" })
    expect(modelToNodeTarget("suno-v5_5")).toEqual({ nodeType: "suno-generate", field: "model", value: "V5_5" })
  })
  // `elevenlabs-dubbing` is a single-provider utility whose id is NOT in any
  // provider-enum array, so it exercises the modes fallback → bare node, no preset.
  it("maps a single-provider utility to its node with no preset field", () => {
    expect(modelToNodeTarget("elevenlabs-dubbing")).toEqual({ nodeType: "dubbing" })
  })
  // `gemini-omni-video` IS a valid provider-enum value (member of both
  // IMAGE_TO_VIDEO_PROVIDERS and TEXT_TO_VIDEO_PROVIDERS), so it resolves via the
  // ENUM_TARGETS path to a provider preset — not the modes fallback (that path is
  // exercised by `elevenlabs-dubbing` above).
  it("returns a provider preset for an enum video model (gemini-omni-video is enum-valid)", () => {
    expect(modelToNodeTarget("gemini-omni-video")).toEqual({ nodeType: "generate-video", field: "provider", value: "gemini-omni-video" })
  })
  it("returns null when there is no node (voice-clone) or unknown id", () => {
    expect(modelToNodeTarget("voice-clone")).toBeNull()
    expect(modelToNodeTarget("totally-unknown")).toBeNull()
  })
  it("never targets suno-generate without a model value (every music model carries dataValue)", () => {
    const bare = Object.values(MODEL_CATALOG)
      .filter((m) => {
        const t = modelToNodeTarget(m.id)
        return t?.nodeType === "suno-generate" && t.value == null
      })
      .map((m) => m.id)
    expect(bare).toEqual([])
  })
})

describe("buildModelTree", () => {
  const tree = buildModelTree()
  const withSeries = (Object.values(MODEL_CATALOG) as Array<{ series?: string }>).filter((m) => m.series)
  it("covers nearly every series-annotated model and renders no empty folder", () => {
    const variants = tree.reduce((n, l) => n + l.models.length, 0)
    expect(variants).toBeGreaterThanOrEqual(withSeries.length - 1)
    for (const line of tree) expect(line.models.length).toBeGreaterThan(0)
  })
  it("series completeness: every node-creatable model declares a series", () => {
    const missing = (Object.values(MODEL_CATALOG) as Array<{ id: string; series?: string }>)
      .filter((m) => modelToNodeTarget(m.id) && (!m.series || !m.series.trim()))
      .map((m) => m.id)
    expect(missing).toEqual([])
  })
  it("keeps ElevenLabs as one line and Flux Kontext inside Flux", () => {
    expect(tree.filter((l) => l.series === "ElevenLabs")).toHaveLength(1)
    const flux = tree.find((l) => l.series === "Flux")
    expect(flux?.models.some((m) => m.label.toLowerCase().includes("kontext"))).toBe(true)
    expect(tree.some((l) => l.series.toLowerCase().includes("kontext"))).toBe(false)
  })
})

describe("searchModelVariants", () => {
  const treeIds = new Set(buildModelTree().flatMap((l) => l.models).map((m) => m.id))

  it("returns [] for a blank query", () => {
    expect(searchModelVariants("")).toEqual([])
    expect(searchModelVariants("   ")).toEqual([])
  })
  it("matches by label or id, case-insensitive", () => {
    const hits = searchModelVariants("FLUX")
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((m) => m.label.toLowerCase().includes("flux") || m.id.toLowerCase().includes("flux"))).toBe(true)
  })
  it("narrows to a single kind when given one", () => {
    const broad = searchModelVariants("a")
    const imageOnly = searchModelVariants("a", "image")
    expect(broad.length).toBeGreaterThan(0)
    expect(imageOnly.length).toBeGreaterThan(0)
    expect(imageOnly.every((m) => m.kind === "image")).toBe(true)
    expect(imageOnly.length).toBeLessThanOrEqual(broad.length)
  })
  it("only returns node-creatable variants (subset of buildModelTree)", () => {
    expect(searchModelVariants("a").every((m) => treeIds.has(m.id))).toBe(true)
  })
})

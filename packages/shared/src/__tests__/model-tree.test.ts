import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "../model-catalog.js"
import { modelToNodeTarget, buildModelTree } from "../model-tree.js"

describe("modelToNodeTarget", () => {
  it("maps an enum image model to generate-image with a provider preset", () => {
    expect(modelToNodeTarget("nano-banana")).toEqual({ nodeType: "generate-image", field: "provider", value: "nano-banana" })
  })
  it("maps suno ids to suno-generate via the model field with the V-code", () => {
    expect(modelToNodeTarget("suno")).toEqual({ nodeType: "suno-generate", field: "model", value: "V4" })
    expect(modelToNodeTarget("suno-v5")).toEqual({ nodeType: "suno-generate", field: "model", value: "V5" })
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

import { describe, it, expect } from "vitest"
import {
  costTier,
  costTierCuts,
  renderModelTable,
  renderRecommendations,
} from "../../../scripts/lib/gen-skills/render-model-guide.js"
import { MODEL_CATALOG, type ModelCatalogEntry, type ModelRecommendation } from "@nodaro/shared"

const CATALOG: Record<string, ModelCatalogEntry> = {
  "z-image": {
    id: "z-image",
    kind: "image",
    modes: ["t2i"],
    family: "Tongyi",
    label: "Z-Image",
    description: "Fast, lightweight generation.",
    useCases: ["fast", "cheap"],
    pricing: [{ identifier: "z-image", credits: 1 }],
  },
  "nano-banana-pro": {
    id: "nano-banana-pro",
    kind: "image",
    modes: ["t2i", "i2i"],
    family: "Google",
    label: "Nano Banana Pro",
    description: "Higher detail, production images.",
    useCases: ["typography", "detail"],
    featured: true,
    pricing: [{ identifier: "nano-banana-pro", credits: 5 }],
  },
  "legacy-thing": {
    id: "legacy-thing",
    kind: "image",
    modes: ["t2i"],
    family: "Old Lab",
    label: "Legacy Thing",
    description: "Superseded — should be hidden.",
    useCases: [],
    mcpHidden: true,
    pricing: [{ identifier: "legacy-thing", credits: 1 }],
  },
  veo3: {
    id: "veo3",
    kind: "video",
    modes: ["i2v", "t2v"],
    family: "Google",
    label: "VEO 3.1 (Quality)",
    description: "Top-quality narrative video with audio.",
    useCases: ["cinematic"],
    features: ["audio"],
    featured: true,
    pricing: [{ identifier: "veo3", credits: 63 }],
  },
  "elevenlabs-v3": {
    id: "elevenlabs-v3",
    kind: "audio",
    modes: ["tts"],
    family: "ElevenLabs",
    label: "ElevenLabs v3",
    description: "Latest TTS, supports audio tags for emotion.",
    useCases: ["voiceover"],
    pricing: [{ identifier: "elevenlabs-v3", credits: 3 }],
  },
}

const RECS: readonly ModelRecommendation[] = [
  {
    intent: "cheapest realistic image",
    modelIds: ["z-image"],
    note: "Z-Image is the cheapest at 1 credit.",
  },
  {
    intent: "best cinematic video",
    modelIds: ["veo3", "not-in-catalog"],
    note: "VEO 3.1 Quality for premium narrative.",
  },
]

describe("costTier", () => {
  const tiersOf = (credits: number[]) => {
    const cuts = costTierCuts(credits)
    return credits.map((c) => costTier(c, cuts))
  }

  it("splits one kind's models into thirds by default price", () => {
    expect(tiersOf([10, 20, 30, 40, 50, 60])).toEqual([
      "Everyday", "Everyday", "Standard", "Standard", "Premium", "Premium",
    ])
  })

  it("is scale-free: the same models at ten times the price keep their tiers", () => {
    // Fixed credit thresholds survived the 2026-07-30 ×10 re-denomination and
    // labelled 120 of 128 models Premium. A relative split cannot drift so.
    const before = [2, 3, 10, 13, 15, 20, 25, 45, 120]
    expect(tiersOf(before.map((c) => c * 10))).toEqual(tiersOf(before))
  })

  it("gives equal prices the same tier", () => {
    const tiers = tiersOf([30, 30, 30, 30, 30, 40, 50])
    expect(new Set(tiers.slice(0, 5)).size).toBe(1)
  })

  it("never labels most of a real kind Premium", () => {
    for (const kind of ["image", "video", "audio"] as const) {
      const credits = Object.values(MODEL_CATALOG)
        .filter((e) => e.kind === kind && !e.mcpHidden)
        .map((e) => e.pricing[0]?.credits ?? 0)
      const premium = tiersOf(credits).filter((t) => t === "Premium").length
      expect(premium / credits.length, kind).toBeLessThan(0.5)
    }
  })
})

describe("renderModelTable", () => {
  it("renders a markdown table for the given kind with header columns", () => {
    const out = renderModelTable(CATALOG, "image")
    expect(out).toContain("| Model |")
    expect(out).toContain("Best for")
    expect(out).toContain("Credits")
  })

  it("includes models of the requested kind with family, credits, and description", () => {
    const out = renderModelTable(CATALOG, "image")
    expect(out).toContain("Z-Image")
    expect(out).toContain("Nano Banana Pro")
    expect(out).toContain("Google")
    expect(out).toContain("Higher detail, production images.")
    // default-variant credits surfaced
    expect(out).toMatch(/Nano Banana Pro.*\b5\b/)
  })

  it("excludes mcpHidden (superseded) models", () => {
    const out = renderModelTable(CATALOG, "image")
    expect(out).not.toContain("Legacy Thing")
  })

  it("does not leak models of other kinds into the table", () => {
    const imageOut = renderModelTable(CATALOG, "image")
    expect(imageOut).not.toContain("VEO 3.1 (Quality)")
    const videoOut = renderModelTable(CATALOG, "video")
    expect(videoOut).toContain("VEO 3.1 (Quality)")
    expect(videoOut).not.toContain("Z-Image")
  })

  it("marks featured models with a star", () => {
    const out = renderModelTable(CATALOG, "image")
    const featuredLine = out
      .split("\n")
      .find((l) => l.includes("Nano Banana Pro"))
    expect(featuredLine).toContain("⭐")
    const plainLine = out.split("\n").find((l) => l.includes("Z-Image"))
    expect(plainLine).not.toContain("⭐")
  })

  it("shows the cost tier label per model", () => {
    const out = renderModelTable(CATALOG, "image")
    const zLine = out.split("\n").find((l) => l.includes("Z-Image"))
    expect(zLine).toContain("Everyday")
  })
})

describe("renderRecommendations", () => {
  it("renders a use-case table resolving model ids to labels", () => {
    const out = renderRecommendations(RECS, CATALOG)
    expect(out).toContain("cheapest realistic image")
    expect(out).toContain("Z-Image") // resolved from id
    expect(out).toContain("Z-Image is the cheapest at 1 credit.")
  })

  it("falls back to the raw id when a model is not in the catalog", () => {
    const out = renderRecommendations(RECS, CATALOG)
    expect(out).toContain("VEO 3.1 (Quality)") // resolved
    expect(out).toContain("not-in-catalog") // fallback raw id
  })
})

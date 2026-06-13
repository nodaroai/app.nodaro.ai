import { describe, it, expect } from "vitest"
import {
  costTier,
  renderModelTable,
  renderRecommendations,
} from "../../../scripts/lib/gen-skills/render-model-guide.js"
import type { ModelCatalogEntry, ModelRecommendation } from "@nodaro/shared"

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
  it("buckets image credits: Everyday <=2, Standard 3-4, Premium >=5", () => {
    expect(costTier("image", 1)).toBe("Everyday")
    expect(costTier("image", 2)).toBe("Everyday")
    expect(costTier("image", 4)).toBe("Standard")
    expect(costTier("image", 5)).toBe("Premium")
  })

  it("buckets video credits on a higher scale: Everyday <=15, Premium >=50", () => {
    expect(costTier("video", 15)).toBe("Everyday")
    expect(costTier("video", 28)).toBe("Standard")
    expect(costTier("video", 50)).toBe("Premium")
    expect(costTier("video", 63)).toBe("Premium")
  })

  it("buckets audio credits: Everyday <=3, Premium >=8", () => {
    expect(costTier("audio", 3)).toBe("Everyday")
    expect(costTier("audio", 5)).toBe("Standard")
    expect(costTier("audio", 8)).toBe("Premium")
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

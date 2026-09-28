import { describe, it, expect } from "vitest"
import { DEFAULT_VIDEO_PROVIDER, IMAGE_GEN_PROVIDERS, settingsProviderModels } from "@nodaro/shared"
import { NODE_DEF_MAP } from "@/types/nodes"
import {
  DEFAULT_PROVIDER_NODE_CATEGORY,
  PROVIDER_NODE_CATEGORIES,
  PROVIDER_NODE_CATEGORY_IDS,
  isProviderNodeCategory,
  validProviderSelection,
} from "../provider-node-models"

describe("Provider node models", () => {
  it("offers only video models Generate Video's Settings input runs", () => {
    const accepted = new Set(settingsProviderModels("generate-video"))
    const refused = PROVIDER_NODE_CATEGORIES.video.models.map((m) => m.value).filter((id) => !accepted.has(id))
    expect(refused).toEqual([])
  })

  it("offers only real image model ids", () => {
    const known = new Set<string>(IMAGE_GEN_PROVIDERS)
    const unknown = PROVIDER_NODE_CATEGORIES.image.models.map((m) => m.value).filter((id) => !known.has(id))
    expect(unknown).toEqual([])
  })

  it("starts each category on a model it offers", () => {
    for (const id of PROVIDER_NODE_CATEGORY_IDS) {
      const entry = PROVIDER_NODE_CATEGORIES[id]
      expect(entry.models.some((m) => m.value === entry.defaultModel)).toBe(true)
    }
  })

  it("keeps a stored pair the panel offers", () => {
    expect(validProviderSelection({ category: "video", provider: "seedance-2" })).toEqual({ category: "video", provider: "seedance-2" })
    expect(validProviderSelection({ category: "image", provider: "nano-banana" })).toEqual({ category: "image", provider: "nano-banana" })
  })

  it("moves a vendor name saved by the old panel to the category's default model", () => {
    expect(validProviderSelection({ category: "video", provider: "pika" })).toEqual({ category: "video", provider: DEFAULT_VIDEO_PROVIDER })
  })

  it("moves a category no node reads to the default category", () => {
    expect(isProviderNodeCategory("voice")).toBe(false)
    expect(validProviderSelection({ category: "voice", provider: "elevenlabs-turbo" })).toEqual({ category: "video", provider: DEFAULT_VIDEO_PROVIDER })
  })

  it("starts a new node on a pair the panel offers", () => {
    const def = NODE_DEF_MAP.get("provider")?.defaultData as { category: string; provider: string }
    expect(def.category).toBe(DEFAULT_PROVIDER_NODE_CATEGORY)
    expect(validProviderSelection({ category: def.category as "video", provider: def.provider })).toEqual({ category: def.category, provider: def.provider })
  })
})

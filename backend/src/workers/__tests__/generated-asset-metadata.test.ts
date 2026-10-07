import { describe, it, expect, vi } from "vitest"

vi.mock("../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { generatedAssetMetadata } from "../shared.js"

describe("generatedAssetMetadata — a generated asset says it is a Preview (A1b)", () => {
  it("an Apply EDL preview keeps its quality beside its thumbnail", () => {
    expect(generatedAssetMetadata({ videoUrl: "v", thumbnailUrl: "t", quality: "proxy" }, "apply-edl")).toEqual({ thumbnail_url: "t", quality: "proxy" })
    expect(generatedAssetMetadata({ audioUrl: "a", quality: "final" }, "apply-edl")).toEqual({ quality: "final" })
  })

  it("another job's output never carries a render quality", () => {
    expect(generatedAssetMetadata({ imageUrl: "i", thumbnailUrl: "t", quality: "proxy" }, "generate-image")).toEqual({ thumbnail_url: "t" })
    expect(generatedAssetMetadata({ imageUrl: "i" }, null)).toEqual({})
  })
})

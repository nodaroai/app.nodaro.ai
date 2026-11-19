import { describe, it, expect, vi } from "vitest"

vi.mock("../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { ASSET_NAME_MAX, generatedAssetMetadata, generatedAssetName } from "../shared.js"

describe("generatedAssetMetadata — a generated asset says it is a Preview (A1b)", () => {
  it("an Apply EDL preview keeps its quality beside its thumbnail", () => {
    expect(generatedAssetMetadata({ videoUrl: "v", thumbnailUrl: "t", quality: "proxy" }, "apply-edl")).toEqual({ thumbnail_url: "t", quality: "proxy" })
    expect(generatedAssetMetadata({ audioUrl: "a", quality: "final" }, "apply-edl")).toEqual({ quality: "final" })
  })

  it("a Speaker View preview is labelled the same way (it is a registered render, C3.2)", () => {
    expect(generatedAssetMetadata({ videoUrl: "v", thumbnailUrl: "t", quality: "proxy" }, "speaker-view")).toEqual({ thumbnail_url: "t", quality: "proxy" })
    expect(generatedAssetMetadata({ videoUrl: "v", quality: "final" }, "speaker-view")).toEqual({ quality: "final" })
  })

  it("another job's output never carries a render quality", () => {
    expect(generatedAssetMetadata({ imageUrl: "i", thumbnailUrl: "t", quality: "proxy" }, "generate-image")).toEqual({ thumbnail_url: "t" })
    expect(generatedAssetMetadata({ imageUrl: "i" }, null)).toEqual({})
  })
})

describe("a song's file carries its name (`metadata.name`, migration 679)", () => {
  const song = {
    audioUrl: "https://cdn.test/audios/j1.wav",
    sunoTitle: "I Found My Love in Portofino",
    sunoImageUrl: "https://cdn.test/cover.jpg",
    sunoTracks: [
      { id: "s1", title: "I Found My Love in Portofino", audioUrl: "https://cdn.test/audios/j1.wav" },
      { id: "s2", title: "A Portofino ho trovato l'amore", audioUrl: "https://cdn.test/audios/j1-v1.wav" },
    ],
  }

  it("names the audio of a Suno job after its first take", () => {
    expect(generatedAssetMetadata(song, "suno-generate", "audio")).toEqual({ name: "I Found My Love in Portofino" })
    expect(generatedAssetName({ sunoTracks: song.sunoTracks }, "audio")).toBe("I Found My Love in Portofino")
  })

  it("names no other file, and no file whose job gave no title", () => {
    expect(generatedAssetName(song, "image")).toBeUndefined()
    expect(generatedAssetName(song, "video")).toBeUndefined()
    expect(generatedAssetName({ audioUrl: "a" }, "audio")).toBeUndefined()
    expect(generatedAssetName({ audioUrl: "a", sunoTitle: "   " }, "audio")).toBeUndefined()
    expect(generatedAssetMetadata(song, "suno-generate")).toEqual({})
  })

  it("trims the name and keeps it to 200 characters", () => {
    expect(ASSET_NAME_MAX).toBe(200)
    expect(generatedAssetName({ sunoTitle: `  ${"x".repeat(250)}  ` }, "audio")).toBe("x".repeat(200))
    expect(generatedAssetName({ sunoTitle: "  Night Drive  " }, "audio")).toBe("Night Drive")
  })
})

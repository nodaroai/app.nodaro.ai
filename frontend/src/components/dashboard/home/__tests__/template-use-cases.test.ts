// @vitest-environment node
import { describe, it, expect } from "vitest"
import { buildUseCaseTiles, TEMPLATE_FILTER_SORT, templatesPageHref } from "../template-use-cases"

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse("2026-09-14T12:00:00Z")
const CATEGORIES = ["image-generation", "video-production", "audio-music"] as const

function tpl(id: string, category: string, previewMediaUrl: string | null, ageDays = 30, previewMediaType?: string) {
  return {
    id,
    category,
    previewMediaUrl,
    previewMediaType: previewMediaType ?? (previewMediaUrl ? "image" : null),
    createdAt: new Date(NOW - ageDays * DAY).toISOString(),
  }
}

describe("TEMPLATE_FILTER_SORT", () => {
  it("maps each filter to a sort the browse endpoint accepts", () => {
    expect(TEMPLATE_FILTER_SORT).toEqual({
      "for-you": "most-favorited",
      trending: "popular",
      "new-this-week": "newest",
    })
  })
})

describe("buildUseCaseTiles", () => {
  it("orders the tiles by each category's best-ranked template, so the sort shows", () => {
    // The API returns templates already ranked for the chosen sort: audio first.
    const tiles = buildUseCaseTiles(
      CATEGORIES,
      [tpl("a", "audio-music", null), tpl("b", "image-generation", "a.png"), tpl("c", "audio-music", null)],
      { filter: "trending", now: NOW },
    )
    expect(tiles.map((t) => t.category)).toEqual(["audio-music", "image-generation"])
  })

  it("drops categories with no templates", () => {
    const tiles = buildUseCaseTiles(CATEGORIES, [tpl("a", "audio-music", null)], { filter: "trending", now: NOW })
    expect(tiles.map((t) => t.category)).toEqual(["audio-music"])
  })

  it("uses the first template with media as the cover, in the order the API ranked them", () => {
    const tiles = buildUseCaseTiles(
      CATEGORIES,
      [
        tpl("a", "video-production", null),
        tpl("b", "video-production", "first.mp4", 30, "video"),
        tpl("c", "video-production", "second.png"),
      ],
      { filter: "trending", now: NOW },
    )
    expect(tiles).toEqual([{ category: "video-production", coverUrl: "first.mp4", coverType: "video", count: 3 }])
  })

  it("leaves the cover empty when no template in the category has media", () => {
    const tiles = buildUseCaseTiles(CATEGORIES, [tpl("a", "audio-music", null)], { filter: "for-you", now: NOW })
    expect(tiles).toEqual([{ category: "audio-music", coverUrl: null, coverType: null, count: 1 }])
  })

  it("puts the categories of the user's own favorites first under For you", () => {
    const tiles = buildUseCaseTiles(
      CATEGORIES,
      [tpl("a", "image-generation", "a.png"), tpl("b", "video-production", "b.png"), tpl("c", "audio-music", "c.png")],
      { filter: "for-you", now: NOW, favoriteIds: ["c"] },
    )
    expect(tiles.map((t) => t.category)).toEqual(["audio-music", "image-generation", "video-production"])
  })

  it("ignores the user's favorites under the other filters", () => {
    const tiles = buildUseCaseTiles(
      CATEGORIES,
      [tpl("a", "image-generation", "a.png"), tpl("c", "audio-music", "c.png")],
      { filter: "trending", now: NOW, favoriteIds: ["c"] },
    )
    expect(tiles.map((t) => t.category)).toEqual(["image-generation", "audio-music"])
  })

  it("counts only templates from the last seven days under New this week", () => {
    const tiles = buildUseCaseTiles(
      CATEGORIES,
      [
        tpl("a", "image-generation", "old.png", 8),
        tpl("b", "image-generation", "new.png", 2),
        tpl("c", "audio-music", "old.mp3", 30),
      ],
      { filter: "new-this-week", now: NOW },
    )
    expect(tiles).toEqual([{ category: "image-generation", coverUrl: "new.png", coverType: "image", count: 1 }])
  })

  it("ignores templates whose category is not a known use case", () => {
    expect(buildUseCaseTiles(CATEGORIES, [tpl("a", "mystery", "x.png")], { filter: "trending", now: NOW })).toEqual([])
  })

  it("with `all`, gives every category a tile in the given order, empty ones without a cover", () => {
    const tiles = buildUseCaseTiles(
      CATEGORIES,
      [tpl("a", "audio-music", "a.mp3", 30, "audio"), tpl("b", "audio-music", null)],
      { filter: "trending", now: NOW, all: true },
    )
    expect(tiles).toEqual([
      { category: "image-generation", coverUrl: null, coverType: null, count: 0 },
      { category: "video-production", coverUrl: null, coverType: null, count: 0 },
      { category: "audio-music", coverUrl: "a.mp3", coverType: "audio", count: 2 },
    ])
  })
})

describe("templatesPageHref", () => {
  it("opens the templates page filtered to the category with the same sort", () => {
    expect(templatesPageHref("video-production", "new-this-week")).toBe(
      "/templates?category=video-production&sort=newest",
    )
  })
})

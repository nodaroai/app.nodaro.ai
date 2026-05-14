import { describe, it, expect } from "vitest"
import { toTutorialResponse, TUTORIAL_SELECT_WITH_CATEGORY } from "@/lib/tutorials-shared.js"

describe("toTutorialResponse", () => {
  const baseRow = {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Getting Started",
    description: "Intro tutorial",
    video_url: "https://example.com/v.mp4",
    thumbnail_url: "https://example.com/t.jpg",
    category_id: "22222222-2222-2222-2222-222222222222",
    sort_order: 0,
    is_enabled: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  }

  it("maps snake_case row to camelCase response", () => {
    const out = toTutorialResponse({ ...baseRow })
    expect(out).toEqual({
      id: baseRow.id,
      type: "video",
      title: "Getting Started",
      description: "Intro tutorial",
      videoUrl: "https://example.com/v.mp4",
      thumbnailUrl: "https://example.com/t.jpg",
      categoryId: baseRow.category_id,
      category: null,
      sortOrder: 0,
      isEnabled: true,
      createdAt: baseRow.created_at,
      updatedAt: baseRow.updated_at,
    })
  })

  it("unwraps embedded category from object form", () => {
    const out = toTutorialResponse({
      ...baseRow,
      tutorial_categories: {
        id: baseRow.category_id,
        name: "Getting Started",
        slug: "getting-started",
        sort_order: 0,
      },
    })
    expect(out.category).toEqual({
      id: baseRow.category_id,
      name: "Getting Started",
      slug: "getting-started",
      sortOrder: 0,
    })
  })

  it("unwraps embedded category from array form (Supabase one-to-many shape)", () => {
    const out = toTutorialResponse({
      ...baseRow,
      tutorial_categories: [
        {
          id: baseRow.category_id,
          name: "Workflows",
          slug: "workflows",
          sort_order: 1,
        },
      ],
    })
    expect(out.category).toEqual({
      id: baseRow.category_id,
      name: "Workflows",
      slug: "workflows",
      sortOrder: 1,
    })
  })

  it("returns null category when embed is missing", () => {
    const out = toTutorialResponse({ ...baseRow, tutorial_categories: null })
    expect(out.category).toBeNull()
  })

  it("tags every response with type='video' so flow + video tutorials can be merged client-side", () => {
    const out = toTutorialResponse({ ...baseRow })
    expect(out.type).toBe("video")
  })
})

describe("TUTORIAL_SELECT_WITH_CATEGORY", () => {
  it("embeds the joined tutorial_categories row", () => {
    expect(TUTORIAL_SELECT_WITH_CATEGORY).toContain("tutorial_categories")
    expect(TUTORIAL_SELECT_WITH_CATEGORY).toContain("id")
    expect(TUTORIAL_SELECT_WITH_CATEGORY).toContain("name")
    expect(TUTORIAL_SELECT_WITH_CATEGORY).toContain("slug")
  })
})

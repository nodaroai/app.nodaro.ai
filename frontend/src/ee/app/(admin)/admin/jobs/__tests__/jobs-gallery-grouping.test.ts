// @vitest-environment node
import { describe, it, expect } from "vitest"
import { ago, buildGroups, dayLabel, tileMedia, type GItem } from "../jobs-gallery-grouping"
import type { AdminJob } from "@/ee/hooks/queries/use-admin-queries"

function job(partial: Partial<AdminJob>): AdminJob {
  return {
    credits: 0,
    created_at: "2026-01-01T12:00:00Z",
    status: "completed",
    output_data: null,
    input_data: null,
    job_type: null,
    ...partial,
  } as AdminJob
}

// Mid-day UTC timestamps so the local calendar day is unambiguous in any TZ.
function gi(created_at: string, credits: number, platKey: string, platLabel = platKey): GItem {
  return { job: job({ created_at, credits }), plat: { key: platKey, label: platLabel } }
}

describe("tileMedia", () => {
  it("video output → video with thumbnail as poster", () => {
    expect(
      tileMedia(job({ output_data: { videoUrl: "https://x/v.mp4", thumbnailUrl: "https://x/t.jpg" } })),
    ).toEqual({ kind: "video", url: "https://x/v.mp4", poster: "https://x/t.jpg" })
    expect(tileMedia(job({ output_data: { videoUrl: "https://x/v.mp4" } }))).toEqual({
      kind: "video",
      url: "https://x/v.mp4",
      poster: null,
    })
  })

  it("suno output (audioUrl + imageUrl) → audio with cover", () => {
    // The image on an audio job is its cover art: the tile follows what was produced.
    expect(
      tileMedia(job({ output_data: { imageUrl: "https://x/cover.jpeg", audioUrl: "https://x/song.mp3" } })),
    ).toEqual({ kind: "audio", url: "https://x/song.mp3", cover: "https://x/cover.jpeg" })
    expect(tileMedia(job({ output_data: { audioUrl: "https://x/s.wav" } }))).toEqual({
      kind: "audio",
      url: "https://x/s.wav",
      cover: null,
    })
  })

  it("image only → image", () => {
    expect(tileMedia(job({ output_data: { imageUrl: "https://x/a.png" } }))).toEqual({
      kind: "image",
      url: "https://x/a.png",
    })
    expect(tileMedia(job({ output_data: { images: ["https://x/b.webp"] } }))).toEqual({
      kind: "image",
      url: "https://x/b.webp",
    })
    // The explicit thumbnail wins, and an extensionless imageUrl still shows.
    expect(tileMedia(job({ output_data: { thumbnailUrl: "https://x/t", imageUrl: "https://x/i.png" } }))).toEqual({
      kind: "image",
      url: "https://x/t",
    })
    expect(tileMedia(job({ output_data: { imageUrl: "https://x/no-ext" } }))).toEqual({
      kind: "image",
      url: "https://x/no-ext",
    })
  })

  it("llm generatedText → text", () => {
    expect(tileMedia(job({ output_data: { generatedText: "Hello there" } }))).toEqual({
      kind: "text",
      text: "Hello there",
    })
    expect(tileMedia(job({ output_data: { generatedText: "  ", result: "fallback" } }))).toEqual({
      kind: "text",
      text: "fallback",
    })
    const long = "x".repeat(500)
    expect(tileMedia(job({ output_data: { text: long } }))).toEqual({ kind: "text", text: "x".repeat(280) })
  })

  it("empty → none", () => {
    expect(tileMedia(job({ output_data: null }))).toEqual({ kind: "none" })
    expect(tileMedia(job({ output_data: {} }))).toEqual({ kind: "none" })
    expect(tileMedia(job({ output_data: { url: "https://x/file.zip", count: 3 } }))).toEqual({ kind: "none" })
  })
})

describe("ago", () => {
  it("formats minutes / hours / days", () => {
    expect(ago(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5m ago")
    expect(ago(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe("3h ago")
    expect(ago(new Date(Date.now() - 2 * 86_400_000).toISOString())).toBe("2d ago")
  })
})

describe("dayLabel", () => {
  it("labels today and yesterday", () => {
    const t = new Date()
    t.setHours(12, 0, 0, 0)
    expect(dayLabel(t.toISOString())).toBe("Today")
    const y = new Date(t)
    y.setDate(y.getDate() - 1)
    expect(dayLabel(y.toISOString())).toBe("Yesterday")
  })
})

describe("buildGroups", () => {
  const items = [
    gi("2026-03-15T10:00:00Z", 10, "web:studio", "studio"),
    gi("2026-03-15T09:00:00Z", 5, "api", "api"),
    gi("2026-03-15T08:00:00Z", 3, "web:studio", "studio"),
    gi("2026-03-14T10:00:00Z", 7, "api", "api"),
  ]

  it("Day → Source: groups by day, sub-groups by platform, sums credits", () => {
    const g = buildGroups(items, "day")
    expect(g).toHaveLength(2) // 03-15 and 03-14
    expect(g[0].outputs).toBe(3)
    expect(g[0].credits).toBe(18)
    expect(g[0].subCount).toBe(2) // studio + api
    const studio = g[0].sections.find((s) => s.key === "web:studio")!
    expect(studio.label).toBe("studio")
    expect(studio.count).toBe(2)
    expect(studio.credits).toBe(13)
    expect(g[1].outputs).toBe(1) // the 03-14 api job
  })

  it("Source → Day: groups by platform, sub-groups by day", () => {
    const g = buildGroups(items, "source")
    expect(g).toHaveLength(2) // studio, api (first-seen order)
    expect(g[0].label).toBe("studio")
    expect(g[0].outputs).toBe(2)
    expect(g[0].subCount).toBe(1) // both studio jobs same day
    const api = g.find((x) => x.key === "api")!
    expect(api.outputs).toBe(2)
    expect(api.subCount).toBe(2) // api on two different days
  })

  it("returns an empty array for no items", () => {
    expect(buildGroups([], "day")).toEqual([])
  })
})

import { describe, it, expect } from "vitest"
import { ago, buildGroups, dayLabel, jobThumb, typeLabel, type GItem } from "../jobs-gallery-grouping"
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

describe("jobThumb", () => {
  it("prefers the thumbnail, then the image, else null", () => {
    expect(jobThumb(job({ output_data: { imageUrl: "https://x/a.png" } }))).toBe("https://x/a.png")
    expect(jobThumb(job({ output_data: { thumbnailUrl: "t", imageUrl: "i" } }))).toBe("t")
    expect(jobThumb(job({ output_data: null }))).toBeNull()
    expect(jobThumb(job({ output_data: {} }))).toBeNull()
    expect(jobThumb(job({ output_data: { videoUrl: "v" } }))).toBeNull()
  })
})

describe("typeLabel", () => {
  it("uses job_type, falls back to input_data.type, else empty", () => {
    expect(typeLabel(job({ job_type: "generate-image" }))).toBe("generate-image")
    expect(typeLabel(job({ job_type: null, input_data: { type: "image-to-text" } }))).toBe("image-to-text")
    expect(typeLabel(job({ job_type: null, input_data: null }))).toBe("")
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

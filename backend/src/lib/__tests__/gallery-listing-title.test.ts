import { beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// A gallery card carries the name the owner gave the job (`title`, migration
// 609), read in the listing's own query beside the prompt — public like the
// prompt. The rest of the gallery is pinned in routes/__tests__/gallery.test.ts.
// ---------------------------------------------------------------------------

const db = vi.hoisted(() => ({
  selects: [] as string[],
  rows: [] as Array<Record<string, unknown>>,
}))
vi.mock("@/lib/supabase.js", () => {
  const chain: Record<string, unknown> = {}
  const proxy: unknown = new Proxy(chain, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => {
          // The count query selects `id` with head:true; the page query selects the job columns.
          const last = db.selects[db.selects.length - 1] ?? ""
          resolve(last.startsWith("id,") ? { data: db.rows, error: null } : { data: null, error: null, count: db.rows.length })
        }
      }
      return (...args: unknown[]) => {
        if (prop === "select") db.selects.push(String(args[0]))
        return proxy
      }
    },
  })
  return { supabase: { from: () => proxy } }
})

import { readGalleryPage } from "../gallery-listing.js"
import { OWNER_VIEW_MODERATION } from "../gallery-moderation.js"

function job(id: string, title: string | null | undefined) {
  return {
    id,
    job_type: "generate-image",
    input_data: { prompt: "a lighthouse at dusk", provider: "gpt-image" },
    output_data: { imageUrl: `https://r2/${id}.png` },
    completed_at: "2026-11-09T06:00:00.000Z",
    user_id: "00000000-0000-4000-8000-000000000001",
    provider: "gpt-image",
    ...(title === undefined ? {} : { title }),
  }
}

beforeEach(() => {
  db.selects = []
  db.rows = []
})

describe("readGalleryPage — the job's name on a card", () => {
  it("selects the name with the card's columns and answers it as `title`, null when unnamed", async () => {
    db.rows = [job("j1", "Hero shot v2"), job("j2", null), job("j3", undefined)]
    const page = await readGalleryPage({ limit: 10, includePrivate: false, moderation: OWNER_VIEW_MODERATION })
    const items = page.rows.map((row) => row.item)
    expect(items.map((item) => [item.id, item.title])).toEqual([
      ["j1", "Hero shot v2"],
      ["j2", null],
      ["j3", null],
    ])
    // Beside the prompt, which is public too.
    expect(items[0].prompt).toBe("a lighthouse at dusk")
    expect(db.selects.some((s) => s.startsWith("id,") && s.split(", ").includes("title"))).toBe(true)
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// The combined favorites read: five tables, one order, one cursor. A small
// in-memory PostgREST stands in for the database: it applies `eq`, `in`,
// `order` + `limit` and the keyset `or()` filters the feed writes (the three
// forms of favorites-cursor.ts), so paging is exercised end to end — ties on
// `created_at` across kinds included.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  errors: {} as Record<string, { code: string; message: string }>,
  reads: [] as string[],
}))

vi.mock("@/lib/supabase.js", () => {
  const micros = (ts: string) => {
    const m = /^(.*?:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(ts)!
    return BigInt(Date.parse(`${m[1]}${m[3]}`)) * 1000n + BigInt((m[2] ?? "").padEnd(6, "0"))
  }
  const cmp = (row: Row, col: string, op: string, value: string) => {
    if (col === "created_at") {
      const a = micros(String(row.created_at))
      const b = micros(value)
      return op === "lt" ? a < b : op === "lte" ? a <= b : a === b
    }
    const a = String(row[col])
    return op === "lt" ? a < value : op === "lte" ? a <= value : a === value
  }
  // The keyset forms: `created_at.lt.T`, `created_at.lte.T`, `created_at.lt.T,and(created_at.eq.T,id.lt.ID)`.
  const keyset = (filter: string) => (row: Row) => {
    const m = /^created_at\.(lt|lte)\.([^,]+)(?:,and\(created_at\.eq\.([^,]+),id\.lt\.([^)]+)\))?$/.exec(filter)
    if (!m) return true
    if (cmp(row, "created_at", m[1]!, m[2]!)) return true
    return m[3] !== undefined && cmp(row, "created_at", "eq", m[3]) && cmp(row, "id", "lt", m[4]!)
  }
  function from(table: string) {
    const preds: Array<(row: Row) => boolean> = []
    let limit = Infinity
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, v: unknown) => (preds.push((r) => r[col] === v), builder),
      in: (col: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[col])), builder),
      is: () => builder,
      or: (f: string) => (f.startsWith("created_at.") ? preds.push(keyset(f)) : undefined, builder),
      not: () => builder,
      neq: () => builder,
      order: () => builder,
      limit: (n: number) => ((limit = n), builder),
      then: (resolve: (v: unknown) => unknown) => {
        db.reads.push(table)
        if (db.errors[table]) return resolve({ data: null, error: db.errors[table] })
        const rows = (db.tables[table] ?? [])
          .filter((r) => preds.every((p) => p(r)))
          .sort((a, b) => {
            const ta = micros(String(a.created_at ?? "1970-01-01T00:00:00Z"))
            const tb = micros(String(b.created_at ?? "1970-01-01T00:00:00Z"))
            if (ta !== tb) return ta > tb ? -1 : 1
            return String(a.id) > String(b.id) ? -1 : 1
          })
          .slice(0, limit)
        return resolve({ data: rows, error: null })
      },
    }
    return builder
  }
  return { supabase: { from } }
})
vi.mock("@/lib/surface-profile.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../surface-profile.js")>()),
  surfaceAllowsPublicOutputs: () => true,
}))

import { readFavoritesPage } from "../favorites-feed.js"
import { decodeFavoritesCursor, FAVORITE_KINDS } from "../favorites-cursor.js"
import { setFavoritesTablesPresentForTests } from "../favorites-tables.js"
import { OWNER_ONLY_RENDER_JOBS } from "../render-listing.js"

const USER = "00000000-0000-4000-8000-000000000001"
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const T = (s: string) => `2026-11-23T10:00:${s}+00:00`

beforeEach(() => {
  db.errors = {}
  db.reads = []
  setFavoritesTablesPresentForTests(true)
  db.tables = {
    gallery_favorites: [
      { id: uuid(11), user_id: USER, job_id: uuid(101), created_at: T("05") },
      // Tied with the voice and the catalog option below, to the microsecond.
      { id: uuid(12), user_id: USER, job_id: uuid(102), created_at: T("03.000001") },
      { id: uuid(13), user_id: "someone-else", job_id: uuid(103), created_at: T("09") },
    ],
    jobs: [
      { id: uuid(101), user_id: USER, job_type: "generate-image", status: "completed", output_data: { imageUrl: "https://cdn.test/1.png" }, created_at: T("00") },
      { id: uuid(102), user_id: USER, job_type: "generate-video", status: "completed", output_data: { videoUrl: "https://cdn.test/2.mp4", thumbnailUrl: "https://cdn.test/2.jpg" }, created_at: T("00") },
    ],
    asset_favorites: [{ id: uuid(21), user_id: USER, asset_id: uuid(201), created_at: T("04") }],
    assets: [{ id: uuid(201), user_id: USER, type: "image", filename: "up.png", r2_url: "https://cdn.test/up.png", metadata: {}, created_at: T("00") }],
    voice_favorites: [
      { id: uuid(31), user_id: USER, voice_id: "v1", voice_type: "premade", name: "Rachel", preview_url: null, created_at: T("03.000001") },
    ],
    node_preset_favorites: [{ id: uuid(41), user_id: USER, node_type: "generate-image", preset_id: "generate-image/character-board", created_at: T("02") }],
    catalog_favorites: [
      { id: uuid(51), user_id: USER, catalog: "mood", option_id: "no-such-mood", created_at: T("03.000001") },
      { id: uuid(52), user_id: USER, catalog: "shot-shapes", option_id: "kinetic-type-beats", created_at: T("01") },
    ],
  }
})

async function everyPage(limit: number, kinds = [...FAVORITE_KINDS]) {
  const seen: string[] = []
  let cursor: string | null = null
  for (let i = 0; i < 20; i++) {
    const page = await readFavoritesPage(USER, kinds, limit, cursor ? decodeFavoritesCursor(cursor) : null)
    seen.push(...page.data.map((item) => `${item.kind}:${item.id}`))
    if (!page.nextCursor) return seen
    cursor = page.nextCursor
  }
  throw new Error("did not end")
}

describe("GET /v1/favorites' read", () => {
  const ALL = [
    `job:${uuid(101)}`,
    `asset:${uuid(201)}`,
    // Three kinds tied on created_at: kind order (job, voice, catalog).
    `job:${uuid(102)}`,
    "voice:v1",
    "catalog:mood/no-such-mood",
    "preset:generate-image/character-board",
    "catalog:shot-shapes/kinetic-type-beats",
  ]

  it("lists every kind of the caller's favorites, newest first, ties broken by kind", async () => {
    const page = await readFavoritesPage(USER, FAVORITE_KINDS, 50, null)
    expect(page.data.map((item) => `${item.kind}:${item.id}`)).toEqual(ALL)
    expect(page.nextCursor).toBeNull()
  })

  it("pages with one cursor: every favorite once, in order, at any page size (boundaries inside the tie)", async () => {
    for (const limit of [1, 2, 3, 4, 6]) expect(await everyPage(limit)).toEqual(ALL)
  })

  it("narrows to the kinds asked, and reads only their tables", async () => {
    expect(await everyPage(1, ["catalog", "voice"])).toEqual(["voice:v1", "catalog:mood/no-such-mood", "catalog:shot-shapes/kinetic-type-beats"])
    expect(db.reads).not.toContain("gallery_favorites")
    expect(db.reads).not.toContain("node_preset_favorites")
  })

  it("carries what renders each kind", async () => {
    const { data } = await readFavoritesPage(USER, FAVORITE_KINDS, 50, null)
    const by = (id: string) => data.find((item) => item.id === id)!
    expect(by(uuid(102)).job).toMatchObject({ mediaType: "video", url: "https://cdn.test/2.mp4", thumbnailUrl: "https://cdn.test/2.jpg", status: "completed" })
    expect(by(uuid(201)).asset).toMatchObject({ type: "image", url: "https://cdn.test/up.png", filename: "up.png" })
    expect(by("v1").voice).toEqual({ voiceId: "v1", voiceType: "premade", name: "Rachel", previewUrl: null })
    expect(by("generate-image/character-board").preset).toEqual({ nodeType: "generate-image", presetId: "generate-image/character-board" })
    expect(by("shot-shapes/kinetic-type-beats").catalog).toEqual({ catalog: "shot-shapes", optionId: "kinetic-type-beats", label: "Kinetic Type Beats" })
    // An option its catalog no longer has keeps its star, with no label.
    expect(by("mood/no-such-mood").catalog?.label).toBeNull()
  })

  it("leaves out a job the caller may no longer see, and keeps paging past it", async () => {
    db.tables.jobs = db.tables.jobs!.filter((j) => j.id !== uuid(101))
    const page = await readFavoritesPage(USER, ["job"], 1, null)
    expect(page.data).toEqual([])
    expect(page.nextCursor).not.toBeNull()
    const next = await readFavoritesPage(USER, ["job"], 1, decodeFavoritesCursor(page.nextCursor!))
    expect(next.data.map((item) => item.id)).toEqual([uuid(102)])
  })

  it("another person's owner-only render (an Apply EDL final) is left out even when public; one's own is listed", async () => {
    const [renderType] = [...OWNER_ONLY_RENDER_JOBS]
    expect(renderType, "the registry has an owner-only render").toBeTruthy()
    const render = { job_type: renderType, status: "completed", is_public: true, output_data: { videoUrl: "https://cdn.test/r.mp4" }, created_at: T("00") }
    db.tables.jobs = [
      { ...render, id: uuid(101), user_id: "someone-else" },
      { ...render, id: uuid(102), user_id: USER },
    ]
    const { data } = await readFavoritesPage(USER, ["job"], 50, null)
    expect(data.map((item) => item.id)).toEqual([uuid(102)])
  })

  it("before migration 688 reaches the database, the upload and option kinds give nothing and are never read", async () => {
    setFavoritesTablesPresentForTests(false)
    const { data } = await readFavoritesPage(USER, FAVORITE_KINDS, 50, null)
    expect(data.map((item) => item.kind)).not.toContain("asset")
    expect(data.map((item) => item.kind)).not.toContain("catalog")
    expect(db.reads).not.toContain("asset_favorites")
    expect(db.reads).not.toContain("catalog_favorites")
  })

  it("a table missing after all reads as empty; any other failure throws", async () => {
    db.errors.catalog_favorites = { code: "PGRST205", message: "Could not find the table" }
    const { data } = await readFavoritesPage(USER, ["catalog", "voice"], 50, null)
    expect(data.map((item) => item.kind)).toEqual(["voice"])
    db.errors.voice_favorites = { code: "57014", message: "statement timeout" }
    await expect(readFavoritesPage(USER, ["voice"], 50, null)).rejects.toMatchObject({ code: "57014" })
  })
})

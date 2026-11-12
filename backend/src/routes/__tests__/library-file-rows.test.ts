/**
 * `GET /v1/library` lists files: a row with no address is not one (decided
 * 2026-11-12).
 *
 * `assets.r2_url` is nullable (migration 179): the retention reapers keep a
 * reaped row for its accounting and clear its `r2_key` and `r2_url`. Such a
 * row has no file to show, so the listing leaves it out — in the QUERY, so a
 * page of `limit` still holds `limit` files while enough remain, the cursor
 * walk meets every file exactly once, and `totalCount` is the number of files
 * that walk returns. Nothing is deleted.
 *
 * Run over an in-memory `assets` table (test/memory-tables.ts), which applies
 * the route's filters with Postgres's NULL semantics.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { MemoryDb, Row } from "../../test/memory-tables.js"

const db = vi.hoisted(() => ({ tables: {} }) as MemoryDb)

vi.mock("../../lib/supabase.js", async () => {
  const { memorySupabase } = await import("../../test/memory-tables.js")
  return { supabase: memorySupabase(db) }
})
vi.mock("../../lib/config.js", () => ({
  config: { EDITION: "cloud", R2_PUBLIC_URL: "https://pub-test.r2.dev" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("../../lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
// The render-label fill reads `jobs`; it has its own tests (library-render-label.test.ts).
vi.mock("../../lib/render-label-fill.js", () => ({ fillAssetRenderQuality: async (rows: readonly unknown[]) => [...rows] }))

const { libraryRoutes } = await import("../library.js")

const USER = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const at = (minute: number) => `2026-09-01T10:${String(minute).padStart(2, "0")}:00+00:00`
const TYPES = ["image", "video", "audio"] as const

/** A row with its file. */
function file(n: number, minute: number, over: Row = {}): Row {
  const type = TYPES[n % 3]!
  return {
    id: id(n),
    user_id: USER,
    type,
    filename: `file-${n}`,
    mime_type: `${type}/x`,
    size_bytes: 1000 + n,
    r2_key: `uploads/${type}s/${n}`,
    r2_url: `https://pub-test.r2.dev/uploads/${type}s/${n}`,
    metadata: {},
    is_library_item: false,
    in_library: true,
    upload_source: "manual_upload",
    source: null,
    source_detail: null,
    created_at: at(minute),
    job_id: null,
    restricted_at: null,
    ...over,
  }
}

/** A row whose file is gone: a reaper cleared its address and kept the row. */
function gone(n: number, minute: number, over: Row = {}): Row {
  return file(n, minute, {
    r2_key: null,
    r2_url: null,
    upload_source: "generated",
    job_id: id(9000 + n),
    metadata: { updated_at: at(minute) },
    size_bytes: 0,
    ...over,
  })
}

/** Rows of every kind the listing meets: files, rows with no file among them, other users', shared items, a restricted file, a timestamp shared by several rows. */
function table(): Row[] {
  return [
    file(1, 59),
    gone(2, 58),
    file(3, 57),
    file(4, 56, { in_library: false }),
    gone(5, 55, { in_library: false }),
    file(6, 54),
    // One transaction's timestamp, shared by four rows (two without a file): the id breaks the tie.
    file(7, 50),
    gone(8, 50),
    file(9, 50),
    gone(10, 50, { r2_url: "", r2_key: "" }),
    file(11, 49, { restricted_at: "2026-10-01T00:00:00+00:00" }),
    file(12, 48),
    gone(13, 47),
    gone(14, 46),
    file(15, 45),
    file(16, 44),
    file(17, 43, { type: "image" }),
    gone(18, 42, { type: "image" }),
    // Shared library items (another user's), one without a file.
    file(19, 41, { user_id: OTHER, is_library_item: true, in_library: false }),
    gone(20, 40, { user_id: OTHER, is_library_item: true, in_library: false }),
    // Another user's own file: never listed for USER.
    file(21, 39, { user_id: OTHER }),
    file(22, 38),
    gone(23, 37),
    file(26, 36),
    file(29, 35),
  ]
}

const hasFile = (r: Row) => typeof r.r2_url === "string" && r.r2_url !== ""

type View = { owned: boolean; type: "all" | "image" | "video" | "audio" }

/** Whether `view` holds `r`, file or not: unrestricted, the view's rows (the Storage set or the library + shared items), of its type. */
const inView = (r: Row, view: View) =>
  r.restricted_at === null &&
  (view.owned ? r.user_id === USER : (r.user_id === USER && r.in_library === true) || r.is_library_item === true) &&
  (view.type === "all" || r.type === view.type)

/** What the listing must answer: the view's rows that are files, newest first, the id breaking a tie. */
function oracle(rows: readonly Row[], view: View): string[] {
  return rows
    .filter((r) => inView(r, view))
    .filter(hasFile)
    .sort((a, b) => (a.created_at === b.created_at ? (String(a.id) < String(b.id) ? 1 : -1) : String(a.created_at) < String(b.created_at) ? 1 : -1))
    .map((r) => String(r.id))
}

interface Page {
  readonly data: Array<Record<string, unknown>>
  readonly nextCursor: string | null
  readonly totalCount?: number
}

let app: FastifyInstance

beforeEach(async () => {
  db.tables = { assets: table() }
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const q = req.query as Record<string, unknown> | undefined
    if (typeof q?.userId === "string") req.userId = q.userId
  })
  await app.register(async (i) => libraryRoutes(i))
  await app.ready()
})
afterEach(async () => app.close())

async function page(view: View, limit: number, cursor?: string): Promise<Page> {
  const qs = new URLSearchParams({ userId: USER, limit: String(limit) })
  if (view.owned) qs.set("owned", "true")
  if (view.type !== "all") qs.set("type", view.type)
  if (cursor) qs.set("cursor", cursor)
  const res = await app.inject({ method: "GET", url: `/v1/library?${qs.toString()}` })
  expect(res.statusCode).toBe(200)
  return res.json() as Page
}

/** Every page of `view`, following `nextCursor` to the end. */
async function walk(view: View, limit: number): Promise<Page[]> {
  const pages: Page[] = []
  let cursor: string | undefined
  for (let i = 0; i < 100; i++) {
    const p = await page(view, limit, cursor)
    pages.push(p)
    if (!p.nextCursor) return pages
    cursor = p.nextCursor
  }
  throw new Error("the walk did not end")
}

const idsOf = (pages: readonly Page[]) => pages.flatMap((p) => p.data.map((a) => String(a.id)))
const GONE = table().filter((r) => !hasFile(r)).map((r) => String(r.id))
const VIEWS: View[] = [true, false].flatMap((owned) => (["all", ...TYPES] as const).map((type) => ({ owned, type })))

describe("GET /v1/library leaves out a row with no file", () => {
  it("the fixture holds rows with no file in every view it lists (the test is not vacuous)", () => {
    expect(GONE.length).toBeGreaterThanOrEqual(8)
    for (const view of VIEWS) {
      const rows = table().filter((r) => inView(r, view))
      expect(rows.some((r) => !hasFile(r)), `${JSON.stringify(view)} has a row with no file`).toBe(true)
      expect(rows.filter(hasFile).length, `${JSON.stringify(view)} has files`).toBeGreaterThanOrEqual(2)
    }
  })

  it("lists no row without an address (null or blank), and keeps the order of the files", async () => {
    const p = await page({ owned: true, type: "all" }, 100)
    expect(p.data.every((a) => typeof a.url === "string" && a.url !== "")).toBe(true)
    expect(p.data.map((a) => a.id)).toEqual(oracle(table(), { owned: true, type: "all" }))
    expect(p.data.map((a) => a.id).filter((x) => GONE.includes(String(x)))).toEqual([])
  })

  it("totalCount is the number of files, in every view and type filter", async () => {
    for (const view of VIEWS) {
      const p = await page(view, 2)
      expect(p.totalCount, JSON.stringify(view)).toBe(oracle(table(), view).length)
    }
  })

  it("a page of limit N holds N files while enough remain", async () => {
    for (const view of VIEWS) {
      for (const limit of [1, 2, 3]) {
        const pages = await walk(view, limit)
        const expected = oracle(table(), view)
        pages.forEach((p, i) => {
          const last = i === pages.length - 1
          expect(p.data.length, `${JSON.stringify(view)} limit ${limit} page ${i}`).toBe(last ? expected.length - limit * i : limit)
        })
      }
    }
  })

  it("the cursor walk returns every file exactly once, in order, for every view, type and page size", async () => {
    for (const view of VIEWS) {
      const expected = oracle(table(), view)
      for (const limit of [1, 2, 3, 4, 5, 40]) {
        const ids = idsOf(await walk(view, limit))
        expect(ids, `${JSON.stringify(view)} limit ${limit}`).toEqual(expected)
        // The count on the first page equals what the whole walk returns.
        expect((await page(view, limit)).totalCount).toBe(ids.length)
      }
    }
  })

  it("answers exactly what the same table without the rows lacking a file answers", async () => {
    const withGone = []
    for (const view of VIEWS) for (const limit of [2, 3, 40]) withGone.push(await walk(view, limit))
    db.tables = { assets: table().filter(hasFile) }
    const without = []
    for (const view of VIEWS) for (const limit of [2, 3, 40]) without.push(await walk(view, limit))
    expect(withGone).toEqual(without)
  })

  it("a cursor a client already holds still resolves when it names a row with no file", async () => {
    // A page served before this rule could end on such a row.
    const cursor = id(8) // no file, created at minute 50, between files 9 and 7
    const p = await page({ owned: true, type: "all" }, 3, cursor)
    const order = oracle(table(), { owned: true, type: "all" })
    expect(p.data.map((a) => a.id)).toEqual(order.slice(order.indexOf(id(7)), order.indexOf(id(7)) + 3))
  })

  it("the shared library's row with no file is left out, its file kept", async () => {
    const ids = idsOf(await walk({ owned: false, type: "all" }, 40))
    expect(ids).toContain(id(19))
    expect(ids).not.toContain(id(20))
  })
})

describe("an install with no row lacking a file answers as before", () => {
  it("a recorded reply, field for field", async () => {
    db.tables = {
      assets: [
        file(1, 59),
        file(2, 58, { type: "video", metadata: { thumbnail_url: "https://pub-test.r2.dev/t/2.jpg" }, upload_source: "generated", job_id: id(9002), source: "mcp", source_detail: "Claude" }),
        file(3, 57, { in_library: false }),
        file(4, 57, { is_library_item: true, user_id: OTHER }),
      ],
    }
    // Recorded from the route before the rule existed.
    expect(await page({ owned: false, type: "all" }, 2)).toEqual({
      data: [
        {
          id: id(1),
          type: "video",
          filename: "file-1",
          mimeType: "video/x",
          sizeBytes: 1001,
          url: "https://pub-test.r2.dev/uploads/videos/1",
          thumbnailUrl: null,
          metadata: {},
          isLibraryItem: false,
          uploadSource: "manual_upload",
          source: null,
          sourceDetail: null,
          jobId: null,
          title: null,
          createdAt: at(59),
        },
        {
          id: id(2),
          type: "video",
          filename: "file-2",
          mimeType: "audio/x",
          sizeBytes: 1002,
          url: "https://pub-test.r2.dev/uploads/audios/2",
          thumbnailUrl: "https://pub-test.r2.dev/t/2.jpg",
          metadata: { thumbnail_url: "https://pub-test.r2.dev/t/2.jpg" },
          isLibraryItem: false,
          uploadSource: "generated",
          source: "mcp",
          sourceDetail: "Claude",
          jobId: id(9002),
          title: null,
          createdAt: at(58),
        },
      ],
      nextCursor: id(2),
      totalCount: 3,
    })
    expect(await page({ owned: false, type: "all" }, 2, id(2))).toEqual({
      data: [expect.objectContaining({ id: id(4), isLibraryItem: true, url: "https://pub-test.r2.dev/uploads/videos/4" })],
      nextCursor: null,
    })
    expect(idsOf(await walk({ owned: true, type: "all" }, 1))).toEqual([id(1), id(2), id(3)])
    expect((await page({ owned: true, type: "video" }, 5)).data.map((a) => a.id)).toEqual([id(1), id(2)])
  })
})

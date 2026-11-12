/**
 * The MCP `browse_uploads` tool lists files: a row with no address is not one
 * (decided 2026-11-12) — the rule `GET /v1/library` applies, in the query, so a
 * page of `limit` holds `limit` files while enough remain, the cursor walk
 * meets every file once and `totalCount` is the number of files.
 *
 * Run over an in-memory `assets` table (test/memory-tables.ts). The rows have
 * distinct timestamps: this tool's cursor is a bare `created_at` comparison,
 * which skips rows tied with a page's last row (its own question, not this one).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import type { MemoryDb, Row } from "../../../../test/memory-tables.js"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool } from "./_helpers.js"

const db = vi.hoisted(() => ({ tables: {} }) as MemoryDb)

vi.mock("../../../supabase.js", async () => {
  const { memorySupabase } = await import("../../../../test/memory-tables.js")
  return { supabase: memorySupabase(db) }
})
// The render-label fill reads `jobs`; it has its own tests.
vi.mock("../../../render-label-fill.js", () => ({ fillAssetRenderQuality: async (rows: readonly unknown[]) => [...rows] }))

const { registerGallery } = await import("../gallery.js")

const USER = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const at = (minute: number) => `2026-09-01T10:${String(minute).padStart(2, "0")}:00+00:00`
const KINDS = ["image", "video", "audio"] as const

function file(n: number, minute: number, over: Row = {}): Row {
  const type = KINDS[n % 3]!
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
    created_at: at(minute),
    job_id: null,
    restricted_at: null,
    ...over,
  }
}

/** A row whose file is gone: a reaper cleared its address and kept the row. */
const gone = (n: number, minute: number, over: Row = {}): Row =>
  file(n, minute, { r2_key: null, r2_url: null, job_id: id(9000 + n), metadata: { updated_at: at(minute) }, size_bytes: 0, ...over })

function table(): Row[] {
  return [
    file(1, 59), gone(2, 58), file(3, 57), gone(4, 56), file(5, 55), file(6, 54), gone(7, 53),
    gone(8, 52, { r2_url: "", r2_key: "" }), file(9, 51), file(10, 50), gone(11, 49), gone(12, 48),
    file(13, 47), file(14, 46), gone(15, 45), file(16, 44), file(17, 43), file(18, 42), gone(19, 41),
    file(20, 40, { restricted_at: "2026-10-01T00:00:00+00:00" }), file(21, 39, { user_id: OTHER }), file(22, 38), file(23, 37),
  ]
}

const hasFile = (r: Row) => typeof r.r2_url === "string" && r.r2_url !== ""
type Kind = (typeof KINDS)[number] | undefined
const inView = (r: Row, kind: Kind) => r.user_id === USER && r.restricted_at === null && (!kind || r.type === kind)
const oracle = (rows: readonly Row[], kind: Kind) =>
  rows.filter((r) => inView(r, kind) && hasFile(r)).sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1)).map((r) => String(r.id))

interface Answer {
  readonly items: Array<Record<string, unknown>>
  readonly nextCursor: string | null
  readonly totalCount: number
  readonly loadMoreTool: string
}

async function browse(args: Record<string, unknown>): Promise<Answer> {
  const server = buildServer()
  registerGallery({ server, session: newSession({ userId: USER, scopes: ["assets:read"] as Scope[], clientName: "Claude" }), fastify: Fastify() })
  const result = await callTool(server, "browse_uploads", args)
  expect(result.isError).toBeUndefined()
  return (result as unknown as { structuredContent: Answer }).structuredContent
}

async function walk(kind: Kind, limit: number): Promise<Answer[]> {
  const pages: Answer[] = []
  let cursor: string | undefined
  for (let i = 0; i < 100; i++) {
    const p = await browse({ limit, ...(kind ? { kind } : {}), ...(cursor ? { cursor } : {}) })
    pages.push(p)
    if (!p.nextCursor) return pages
    cursor = p.nextCursor
  }
  throw new Error("the walk did not end")
}

beforeEach(() => {
  db.tables = { assets: table() }
})

const idsOf = (pages: readonly Answer[]) => pages.flatMap((p) => p.items.map((it) => String(it.jobId)))
const KIND_VIEWS: Kind[] = [undefined, ...KINDS]

describe("browse_uploads leaves out a row with no file", () => {
  it("the fixture holds rows with no file, and files, in every kind (the test is not vacuous)", () => {
    for (const kind of KIND_VIEWS) {
      const rows = table().filter((r) => inView(r, kind))
      expect(rows.some((r) => !hasFile(r)), String(kind)).toBe(true)
      expect(rows.filter(hasFile).length, String(kind)).toBeGreaterThanOrEqual(2)
    }
  })

  it("lists no row without an address, keeps the order, and counts only files", async () => {
    for (const kind of KIND_VIEWS) {
      const p = await browse({ limit: 100, ...(kind ? { kind } : {}) })
      expect(p.items.every((it) => typeof it.assetUrl === "string" && it.assetUrl !== "")).toBe(true)
      expect(p.items.map((it) => it.jobId), String(kind)).toEqual(oracle(table(), kind))
      expect((await browse({ limit: 2, ...(kind ? { kind } : {}) })).totalCount, String(kind)).toBe(oracle(table(), kind).length)
    }
  })

  it("a page of limit N holds N files while enough remain, and the walk meets every file once", async () => {
    for (const kind of KIND_VIEWS) {
      const expected = oracle(table(), kind)
      for (const limit of [1, 2, 3, 4]) {
        const pages = await walk(kind, limit)
        pages.forEach((p, i) => {
          expect(p.items.length, `${String(kind)} limit ${limit} page ${i}`).toBe(i === pages.length - 1 ? expected.length - limit * i : limit)
        })
        expect(idsOf(pages), `${String(kind)} limit ${limit}`).toEqual(expected)
        expect(pages[0]!.totalCount).toBe(expected.length)
      }
    }
  })

  it("answers exactly what the same table without the rows lacking a file answers", async () => {
    const withGone = []
    for (const kind of KIND_VIEWS) for (const limit of [2, 5]) withGone.push(await walk(kind, limit))
    db.tables = { assets: table().filter(hasFile) }
    const without = []
    for (const kind of KIND_VIEWS) for (const limit of [2, 5]) without.push(await walk(kind, limit))
    expect(withGone).toEqual(without)
  })
})

describe("browse_uploads on an install with no row lacking a file answers as before", () => {
  it("a recorded reply, field for field", async () => {
    db.tables = {
      assets: [
        file(1, 59, { metadata: { thumbnail_url: "https://pub-test.r2.dev/t/1.jpg" } }),
        file(2, 58, { metadata: { quality: "proxy" } }),
        file(3, 57),
      ],
    }
    // Recorded from the tool before the rule existed.
    expect(await browse({ limit: 2 })).toEqual({
      items: [
        {
          jobId: id(1),
          kind: "video",
          prompt: "file-1",
          model: "upload",
          thumbnailUrl: "https://pub-test.r2.dev/t/1.jpg",
          assetUrl: "https://pub-test.r2.dev/uploads/videos/1",
          createdAt: at(59),
          favorited: false,
        },
        {
          jobId: id(2),
          kind: "audio",
          prompt: "file-2",
          model: "upload",
          thumbnailUrl: "https://pub-test.r2.dev/uploads/audios/2",
          assetUrl: "https://pub-test.r2.dev/uploads/audios/2",
          createdAt: at(58),
          favorited: false,
          preview: true,
        },
      ],
      nextCursor: id(2),
      totalCount: 3,
      loadMoreTool: "browse_uploads",
    })
    expect(await browse({ limit: 2, cursor: id(2) })).toEqual({
      items: [expect.objectContaining({ jobId: id(3), kind: "image", assetUrl: "https://pub-test.r2.dev/uploads/images/3" })],
      nextCursor: null,
      totalCount: 1,
      loadMoreTool: "browse_uploads",
    })
  })
})

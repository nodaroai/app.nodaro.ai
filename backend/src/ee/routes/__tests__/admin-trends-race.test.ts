/**
 * Two promotions racing on a PUBLISHED trend, through the REAL store
 * (ee/lib/trends/store.ts) over an in-memory table double that keeps the
 * database's own rules: the (trend_id, version) primary key (23505), and
 * filtered updates that touch only the rows that still match.
 *
 * The race (review of Task 13, fix round 2): both promotions read the
 * published version 1 at revision R; A inserts version 2, moves the pointer
 * and answers 201; only then does B's insert of version 2 run, and it hits
 * 23505. B must never overwrite A's version 2: A's example stays, B's lands
 * exactly once (or B is a 409), never a lost or duplicated example.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { TrendVersionData } from "../../lib/trends/types.js"

type Row = Record<string, unknown>

const world = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  inserts: 0,
  /**
   * The race, made deterministic: the FIRST insert into trend_versions waits
   * until the second writer has reached its own insert (so both read the
   * published version first); the SECOND then waits for `gate` (released once
   * the first promotion has answered).
   */
  gate: null as null | Promise<void>,
  secondArrived: null as null | (() => void),
  secondArrival: null as null | Promise<void>,
  admins: new Set<string>(),
  downloads: new Map<string, string>(),
}))

vi.mock("../../../lib/supabase.js", () => {
  /** `col`, `a->>b` or `a->b->>c`. */
  const read = (row: Row, path: string): unknown => {
    const parts = path.split(/->>?/)
    let v: unknown = row
    for (const p of parts) v = v && typeof v === "object" ? (v as Row)[p] : undefined
    return v
  }
  const KEYS: Record<string, string[]> = { trend_versions: ["trend_id", "version"], trends: ["id"] }

  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = []
    let op: "select" | "insert" | "update" | "delete" = "select"
    let payload: Row = {}
    let returning = false

    const run = async (): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve()
      const rows = (world.tables[table] ??= [])
      const match = rows.filter((r) => filters.every((f) => f(r)))
      if (op === "select") return { data: structuredClone(match), error: null }
      if (op === "insert") {
        if (table === "trend_versions" && world.gate) {
          const n = ++world.inserts
          if (n === 1) await Promise.race([world.secondArrival, new Promise((r) => setTimeout(r, 2000))])
          if (n === 2) {
            world.secondArrived?.()
            await world.gate
          }
        }
        const key = KEYS[table] ?? []
        if (rows.some((r) => key.every((k) => r[k] === payload[k]))) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }
        }
        const row: Row = {
          ...(table === "trend_versions"
            ? { revision: crypto.randomUUID(), created_at: new Date().toISOString(), published_at: null }
            : {}),
          ...structuredClone(payload),
        }
        rows.push(row)
        return { data: returning ? structuredClone(row) : null, error: null }
      }
      if (op === "update") {
        for (const r of match) Object.assign(r, structuredClone(payload))
        return { data: returning ? structuredClone(match) : null, error: null }
      }
      world.tables[table] = rows.filter((r) => !match.includes(r))
      return { data: null, error: null }
    }

    const b: Record<string, unknown> = {
      select: () => {
        if (op !== "select") returning = true
        return b
      },
      insert: (p: Row) => ((op = "insert"), (payload = p), b),
      update: (p: Row) => ((op = "update"), (payload = p), b),
      delete: () => ((op = "delete"), b),
      eq: (c: string, v: unknown) => (filters.push((r) => read(r, c) === v), b),
      filter: (c: string, o: string, v: unknown) => (filters.push((r) => o === "eq" && read(r, c) === v), b),
      is: (c: string, v: null) => (filters.push((r) => (read(r, c) ?? null) === v), b),
      lt: (c: string, v: string) => (filters.push((r) => String(read(r, c)) < v), b),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(read(r, c))), b),
      order: () => b,
      limit: () => b,
      maybeSingle: async () => {
        const res = await run()
        return { ...res, data: Array.isArray(res.data) ? (res.data[0] ?? null) : res.data }
      },
      single: async () => {
        const res = await run()
        return { ...res, data: Array.isArray(res.data) ? (res.data[0] ?? null) : res.data }
      },
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => run().then(ok, ko),
    }
    return b
  }
  return { supabase: { from } }
})

vi.mock("../../../lib/admin-check.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/admin-check.js")>()
  return { ...actual, checkIsAdmin: async (userId: string) => world.admins.has(userId) }
})

vi.mock("../../../lib/storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/storage.js")>()
  return { ...actual, uploadFileWithKeyToR2: async (_file: string, key: string) => `https://cdn.test/${key}` }
})

vi.mock("../../../providers/video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../providers/video/ffmpeg-utils.js")>()
  const { writeFile } = await import("node:fs/promises")
  const MP4 = Buffer.from([0, 0, 0, 0x18, ...Buffer.from("ftypisom"), 0, 0, 0, 0])
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return {
    ...actual,
    downloadFile: async (url: string, dest: string) => {
      world.downloads.set(dest, url)
      await writeFile(dest, url.endsWith(".mp4") ? MP4 : PNG)
    },
    probeVideoSource: async () => ({ width: 720, height: 1280, durationSeconds: 12 }),
  }
})

import { adminTrendsRoutes } from "../admin-trends.js"

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const T1 = "00000000-0000-4000-8000-0000000000a1"
const RUN_A = "00000000-0000-4000-8000-0000000000b1"
const RUN_B = "00000000-0000-4000-8000-0000000000b2"

const DATA: TrendVersionData = {
  name: { en: "Neon Dance" },
  source: { videoUrl: `https://cdn.test/trends/${T1}/src.mp4`, durationSec: 12 },
  previewStart: 0,
  slots: [{ key: "lead", label: { en: "Lead" }, kind: "person", required: true, roleName: "the dancer" }],
  references: [],
  examples: [],
}

function run(id: string): Row {
  return {
    id,
    user_id: ADMIN,
    status: "completed",
    progress: 100,
    input_data: {
      type: "cast-swap",
      trend: { id: T1, slug: "neon-dance", version: 1, name: "Neon Dance" },
      slots: [{ key: "lead", label: "Lead", kind: "person", images: [`https://u.example/${id}.png`], fromExample: false }],
      preview: false,
      resolution: "480p",
      draft: true,
    },
    output_data: { videoUrl: `https://out.example/${id}.mp4` },
    error_message: null,
    error_hint: null,
    created_at: "2026-10-20T10:00:00Z",
    started_at: null,
    completed_at: "2026-10-20T10:00:00Z",
    usage_log_id: null,
  }
}

let app: FastifyInstance

beforeEach(async () => {
  world.inserts = 0
  world.gate = null
  world.secondArrived = null
  world.secondArrival = null
  world.admins = new Set([ADMIN])
  world.downloads = new Map()
  world.tables = {
    trends: [{
      id: T1, slug: "neon-dance", status: "published", tags: [], badges: [], sort_order: 0,
      draft_version: 1, published_version: 1, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
    }],
    trend_versions: [{
      trend_id: T1, version: 1, data: structuredClone(DATA), revision: "r-published",
      created_at: "2026-10-01T00:00:00Z", published_at: "2026-10-01T00:00:00Z",
    }],
    jobs: [run(RUN_A), run(RUN_B)],
  }
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
  })
  await app.register(adminTrendsRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const promote = (jobId: string) =>
  app.inject({ method: "POST", url: `/v1/admin/trends/${T1}/examples`, headers: { "x-user-id": ADMIN }, payload: { jobId } })

describe("two promotions on a published trend (copy-on-write race)", () => {
  it("the second writer's 23505 never overwrites the first's version 2: every 201's example lands exactly once", async () => {
    // The second insert into trend_versions waits until the first promotion has answered.
    let release!: () => void
    world.gate = new Promise<void>((r) => (release = r))
    world.secondArrival = new Promise<void>((r) => (world.secondArrived = r))
    const a = promote(RUN_A)
    const b = promote(RUN_B)
    void Promise.race([a, b]).then(() => release())
    const results = await Promise.all([a, b])

    expect(world.inserts).toBeGreaterThanOrEqual(2) // the 23505 path was taken
    const trend = world.tables.trends![0]!
    expect(trend.draft_version).toBe(2)
    const versions = world.tables.trend_versions!
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2])
    // The published version is untouched.
    expect((versions.find((v) => v.version === 1)!.data as TrendVersionData).examples).toEqual([])

    const examples = (versions.find((v) => v.version === 2)!.data as TrendVersionData).examples.map((e) => e.sourceJobId)
    const landed = [RUN_A, RUN_B].filter((_, i) => results[i]!.statusCode === 201)
    for (const [i, res] of results.entries()) expect([201, 409], `promotion ${i}`).toContain(res.statusCode)
    expect(landed.length).toBeGreaterThanOrEqual(1)
    // Every promotion told 201 is in the draft, exactly once; no example appears twice.
    expect([...examples].sort()).toEqual([...landed].sort())
    expect(new Set(examples).size).toBe(examples.length)
  })
})

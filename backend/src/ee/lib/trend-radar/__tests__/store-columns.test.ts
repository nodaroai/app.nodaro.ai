/**
 * The columns migration 735 added (store.ts): served on a database that has
 * them, never `panel`; on one that does not yet (staging runs dev code on the
 * shared database before main), every read and write that names them is made
 * again without them, and the card carries their defaults.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const db = vi.hoisted(() => ({
  /** Whether the database lacks 735's columns. */
  missing: false,
  rows: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ table: string; op: string; cols?: string; payload?: Record<string, unknown> }>,
}))

const ADDED = ["platforms", "creators_capped", "first_posted_at", "last_read_at", "panel", "growth_pct"]

vi.mock("../../../../lib/supabase.js", () => {
  function builder(table: string) {
    let cols: string | undefined
    let payload: Record<string, unknown> | undefined
    let op = "select"
    let single = false
    const answer = () => {
      db.calls.push({ table, op, ...(cols !== undefined ? { cols } : {}), ...(payload !== undefined ? { payload } : {}) })
      const named = [...(cols ? cols.split(",").map((c) => c.trim()) : []), ...Object.keys(payload ?? {})]
      if (db.missing && named.some((c) => ADDED.includes(c))) return { data: null, error: { code: "42703", message: "column does not exist" } }
      return { data: single ? (db.rows[0] ?? null) : db.rows, error: null }
    }
    const q: Record<string, unknown> = {}
    const chain = () => q
    Object.assign(q, {
      select: (c: string) => {
        cols = c
        return q
      },
      insert: (p: Record<string, unknown>) => {
        op = "insert"
        payload = p
        return q
      },
      update: (p: Record<string, unknown>) => {
        op = "update"
        payload = p
        return q
      },
      upsert: (p: Record<string, unknown>) => {
        op = "upsert"
        payload = p
        return q
      },
      eq: chain,
      in: chain,
      not: chain,
      order: chain,
      range: chain,
      single: () => {
        single = true
        return q
      },
      maybeSingle: () => {
        single = true
        return q
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(answer()).then(resolve, reject),
    })
    return q
  }
  return { supabase: { from: (table: string) => builder(table) } }
})

import { listCandidates, listOpenCandidates, listReadings, readCandidateRow, toCard, updateOpenCandidate, writeReading } from "../store.js"

const BASE_ROW = {
  id: "c1",
  name: "cat dance",
  slug: "cat-dance",
  status: "candidate",
  label: "rising",
  sound_name: null,
  duration_sec: 12,
  creators: 9,
  plays: 1000,
  day_change_pct: 4,
  first_seen_kind: "template-site",
  first_seen_name: "Site A",
  first_seen_url: null,
  first_seen_at: "2026-11-01T00:00:00Z",
  top_post: null,
  posts: [],
  templates_elsewhere: [],
  search: null,
  history: [],
  summary: null,
  reject_reason: null,
  passed_at: null,
  trend_id: null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
}

beforeEach(() => {
  db.missing = false
  db.rows = [{ ...BASE_ROW }]
  db.calls = []
})

describe("with migration 735's columns", () => {
  it("the card carries them, and never the panel", async () => {
    db.rows = [{ ...BASE_ROW, platforms: { tiktok: { posts: 3, creators: 3, plays: 900, capped: true, top: null } }, creators_capped: true, first_posted_at: "2026-10-20T00:00:00Z", last_read_at: "2026-11-02T04:30:00Z", panel: { "tiktok:1": 5 } }]
    const page = await listCandidates({})
    expect(page.data[0]).toEqual(
      expect.objectContaining({
        creatorsCapped: true,
        platforms: { tiktok: { posts: 3, creators: 3, plays: 900, capped: true, top: null } },
        firstPostedAt: "2026-10-20T00:00:00Z",
        lastReadAt: "2026-11-02T04:30:00Z",
      }),
    )
    expect(page.data[0]).not.toHaveProperty("panel")
    expect(db.calls[0]!.cols).toContain("platforms")
    expect(db.calls[0]!.cols).not.toContain("panel")
  })

  it("the run's list carries the panel and when each was read", async () => {
    await listOpenCandidates()
    expect(db.calls[0]!.cols).toContain("panel")
    expect(db.calls[0]!.cols).toContain("last_read_at")
  })

  it("a reading's growth is read and written", async () => {
    db.rows = [{ candidate_id: "c1", day: "2026-11-02", creators: 3, plays: 900, posts: 3, growth_pct: 12.5 }]
    expect(await listReadings("c1")).toEqual([{ date: "2026-11-02", creators: 3, plays: 900, posts: 3, growthPct: 12.5 }])
    db.calls = []
    await writeReading("c1", { day: "2026-11-02", creators: 3, plays: 900, posts: 3, growthPct: 12.5 })
    expect(db.calls[0]!.payload).toEqual(expect.objectContaining({ growth_pct: 12.5 }))
  })
})

describe("on a database without them yet", () => {
  beforeEach(() => {
    db.missing = true
  })

  it("a read is made again without them, and the card carries their defaults", async () => {
    const row = await readCandidateRow("c1")
    expect(db.calls.map((c) => c.cols?.includes("platforms"))).toEqual([true, false])
    expect(toCard(row!)).toEqual(expect.objectContaining({ creatorsCapped: false, platforms: {}, firstPostedAt: null, lastReadAt: null }))
    db.calls = []
    const page = await listCandidates({ sort: "plays" })
    expect(page.data).toHaveLength(1)
    expect(db.calls).toHaveLength(2)
  })

  it("the run's list comes back without the keys, so the run keeps its old order", async () => {
    const rows = await listOpenCandidates()
    expect(rows[0]).not.toHaveProperty("last_read_at")
    expect(rows[0]).not.toHaveProperty("panel")
  })

  it("readings are read without growth (null), and written without it", async () => {
    db.rows = [{ candidate_id: "c1", day: "2026-11-02", creators: 3, plays: 900, posts: 3 }]
    expect(await listReadings("c1")).toEqual([{ date: "2026-11-02", creators: 3, plays: 900, posts: 3, growthPct: null }])
    db.calls = []
    await writeReading("c1", { day: "2026-11-02", creators: 3, plays: 900, posts: 3, growthPct: 12.5 })
    const upserts = db.calls.filter((c) => c.op === "upsert")
    expect(upserts).toHaveLength(2)
    expect(upserts[1]!.payload).not.toHaveProperty("growth_pct")
    expect(upserts[1]!.payload).toEqual(expect.objectContaining({ creators: 3, plays: 900 }))
  })

  it("the run's write is made again without the new fields, keeping the rest", async () => {
    const written = await updateOpenCandidate("c1", { status: "candidate", label: "hot", creators: 12, platforms: {}, creatorsCapped: true, firstPostedAt: "2026-10-20T00:00:00Z", lastReadAt: "2026-11-02T04:30:00Z", panel: { a: 1 } })
    expect(written).not.toBeNull()
    const updates = db.calls.filter((c) => c.op === "update")
    expect(updates).toHaveLength(2)
    expect(Object.keys(updates[0]!.payload!)).toEqual(expect.arrayContaining(["platforms", "creators_capped", "first_posted_at", "last_read_at", "panel"]))
    for (const key of ["platforms", "creators_capped", "first_posted_at", "last_read_at", "panel"]) expect(updates[1]!.payload).not.toHaveProperty(key)
    expect(updates[1]!.payload).toEqual(expect.objectContaining({ status: "candidate", label: "hot", creators: 12 }))
  })
})

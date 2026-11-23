import { beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// One favorites list for uploads and generations (lib/asset-favorites.ts).
// An in-memory stand-in for the four tables and migration 688's
// `library_favorite_asset_ids` (the predicate itself is proven against real
// Postgres in supabase/tests/asset-catalog-favorites.behavior.sql; here, what
// the module does with it): `eq`, `in`, `is` (on a column, or on the embedded
// job of a favorite), the `or()` forms the module writes, `maybeSingle`,
// `insert` (with the tables' unique keys) and `delete`.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  missing: new Set<string>(),
  missingFunctions: false,
  ops: [] as string[],
  /**
   * Runs once, the second time a job or a job's favorite is touched — after
   * any read a call makes before it writes, before the write: a concurrent
   * call landing in that window.
   */
  concurrent: null as null | (() => void),
  touches: 0,
}))

/** The unique keys of the tables the module inserts into. */
const UNIQUE: Record<string, string[]> = { gallery_favorites: ["user_id", "job_id"], asset_favorites: ["user_id", "asset_id"] }

vi.mock("@/lib/supabase.js", () => {
  const missing = (name: string) => ({ data: null, error: { code: "42P01", message: `relation "${name}" does not exist` } })
  const trashed = (jobId: unknown) => (db.tables.jobs ?? []).find((j) => j.id === jobId)?.deleted_at != null

  function from(table: string) {
    if ((table === "jobs" || table === "gallery_favorites") && db.concurrent && ++db.touches === 2) {
      const land = db.concurrent
      db.concurrent = null
      land()
    }
    const preds: Array<(row: Row) => boolean> = []
    let op: "select" | "delete" = "select"
    const run = () => (db.tables[table] ?? []).filter((r) => preds.every((p) => p(r)))
    const builder: Record<string, unknown> = {
      select: () => (db.ops.push(`select ${table}`), builder),
      delete: () => ((op = "delete"), builder),
      eq: (col: string, v: unknown) => (preds.push((r) => r[col] === v), builder),
      in: (col: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[col])), builder),
      is: (col: string, v: unknown) => {
        // The embedded job's Trash column (`job.deleted_at`, an inner embed): the favorite's job is out of the Trash.
        if (col === "job.deleted_at") preds.push((r) => !trashed(r.job_id))
        else preds.push((r) => (r[col] ?? null) === v)
        return builder
      },
      or: (f: string) => {
        const terms = f.split(",").map((t) => /^(\w+)\.eq\.(.+)$/.exec(t)).filter(Boolean) as RegExpExecArray[]
        if (terms.length > 0 && !f.includes("and(")) preds.push((r) => terms.some(([, c, v]) => String(r[c!]) === v))
        return builder
      },
      limit: () => builder,
      order: () => builder,
      maybeSingle: async () => {
        if (db.missing.has(table)) return missing(table)
        return { data: run()[0] ?? null, error: null }
      },
      insert: async (row: Row) => {
        if (db.missing.has(table)) return missing(table)
        db.ops.push(`insert ${table}`)
        const key = UNIQUE[table] ?? []
        const rows = db.tables[table] ?? []
        if (key.length > 0 && rows.some((r) => key.every((k) => r[k] === row[k]))) {
          return { error: { code: "23505", message: "duplicate key value violates unique constraint" } }
        }
        db.tables[table] = [...rows, { id: `row-${db.ops.length}`, ...row }]
        return { error: null }
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (db.missing.has(table)) return resolve(missing(table))
        const rows = run()
        if (op === "delete") {
          db.ops.push(`delete ${table}`)
          db.tables[table] = (db.tables[table] ?? []).filter((r) => !rows.includes(r))
          return resolve({ data: null, error: null })
        }
        return resolve({ data: rows, error: null })
      },
    }
    return builder
  }

  /** migration 688's library_file_is_favorite: the file's own star, or its job's favorite while the job is out of the Trash. */
  function isFavorite(userId: unknown, asset: Row): boolean {
    const own = (db.tables.asset_favorites ?? []).some((f) => f.user_id === userId && f.asset_id === asset.id)
    const viaJob =
      asset.job_id != null &&
      (db.tables.gallery_favorites ?? []).some((g) => g.user_id === userId && g.job_id === asset.job_id) &&
      !trashed(asset.job_id)
    return own || viaJob
  }

  async function rpc(fn: string, args: { p_user_id: string; p_asset_ids: string[] }) {
    db.ops.push(`rpc ${fn}`)
    if (db.missingFunctions) return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}` } }
    const ids = (db.tables.assets ?? []).filter((a) => args.p_asset_ids.includes(String(a.id)) && isFavorite(args.p_user_id, a)).map((a) => a.id)
    return { data: ids, error: null }
  }
  return { supabase: { from, rpc } }
})
vi.mock("@/lib/surface-profile.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../surface-profile.js")>()),
  surfaceAllowsPublicOutputs: () => true,
}))

import { favoriteStateOfFiles, isMissingFavoritesSchema, setFileFavorite } from "../asset-favorites.js"
import { favoritesTablesPresent, setFavoritesTablesPresentForTests } from "../favorites-tables.js"

const ME = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"
const UPLOAD = "00000000-0000-4000-8000-0000000000a1"
const MADE = "00000000-0000-4000-8000-0000000000a2"
const SHARED = "00000000-0000-4000-8000-0000000000a3"
const PRIVATE = "00000000-0000-4000-8000-0000000000a4"
const IN_TRASH = "00000000-0000-4000-8000-0000000000a5"
const JOB = "00000000-0000-4000-8000-0000000000b1"
const TRASHED_JOB = "00000000-0000-4000-8000-0000000000b2"

beforeEach(() => {
  db.missing = new Set()
  db.missingFunctions = false
  db.ops = []
  db.concurrent = null
  db.touches = 0
  setFavoritesTablesPresentForTests(true)
  db.tables = {
    assets: [
      { id: UPLOAD, user_id: ME, job_id: null, is_library_item: false },
      { id: MADE, user_id: ME, job_id: JOB, is_library_item: false },
      { id: SHARED, user_id: OTHER, job_id: null, is_library_item: true },
      { id: PRIVATE, user_id: OTHER, job_id: null, is_library_item: false },
      { id: IN_TRASH, user_id: ME, job_id: TRASHED_JOB, is_library_item: false },
    ],
    jobs: [
      { id: JOB, user_id: ME, status: "completed", is_public: false },
      { id: TRASHED_JOB, user_id: ME, status: "completed", is_public: false, deleted_at: "2026-11-01T00:00:00Z" },
    ],
    gallery_favorites: [],
    asset_favorites: [],
  }
})

const stateOf = async (id: string, jobId: string | null) => (await favoriteStateOfFiles(ME, [{ id, job_id: jobId }])).get(id)

describe("each listed file's flag", () => {
  it("is read in one call for the page, by the database's predicate", async () => {
    db.tables.gallery_favorites = [{ id: "g1", user_id: ME, job_id: JOB }]
    db.tables.asset_favorites = [{ id: "f1", user_id: ME, asset_id: UPLOAD }]
    const state = await favoriteStateOfFiles(ME, [
      { id: UPLOAD, job_id: null },
      { id: MADE, job_id: JOB },
      { id: SHARED, job_id: null },
    ])
    expect([...state]).toEqual([[UPLOAD, true], [MADE, true], [SHARED, false]])
    expect(db.ops).toEqual(["rpc library_favorite_asset_ids"])
  })

  it("an empty page reads nothing", async () => {
    expect((await favoriteStateOfFiles(ME, [])).size).toBe(0)
    expect(db.ops).toEqual([])
  })

  it("only the caller's own stars count", async () => {
    db.tables.asset_favorites = [{ id: "f1", user_id: OTHER, asset_id: SHARED }]
    expect(await stateOf(SHARED, null)).toBe(false)
  })

  it("a job's favorite does not count while the job is in the Trash (as GET /v1/favorites leaves it out)", async () => {
    db.tables.gallery_favorites = [{ id: "g1", user_id: ME, job_id: TRASHED_JOB }]
    expect(await stateOf(IN_TRASH, TRASHED_JOB)).toBe(false)
  })

  it("throws on any other database failure (the route then leaves the flag out)", async () => {
    const { supabase } = await import("../supabase.js")
    const spy = vi.spyOn(supabase, "rpc").mockResolvedValueOnce({ data: null, error: { code: "57014", message: "timeout" } } as never)
    await expect(favoriteStateOfFiles(ME, [{ id: UPLOAD, job_id: null }])).rejects.toMatchObject({ code: "57014" })
    spy.mockRestore()
  })
})

describe("starring a library file", () => {
  it("an upload gets its own star; the toggle takes it back", async () => {
    expect(await setFileFavorite(ME, UPLOAD, undefined)).toEqual({ kind: "ok", favorited: true, jobId: null })
    expect(db.tables.asset_favorites).toHaveLength(1)
    expect(await stateOf(UPLOAD, null)).toBe(true)
    expect(await setFileFavorite(ME, UPLOAD, undefined)).toEqual({ kind: "ok", favorited: false, jobId: null })
    expect(db.tables.asset_favorites).toHaveLength(0)
  })

  it("a file a job made is starred on its job — the same favorite as Job.favorited", async () => {
    expect(await setFileFavorite(ME, MADE, true)).toEqual({ kind: "ok", favorited: true, jobId: JOB })
    expect(db.tables.gallery_favorites).toEqual([expect.objectContaining({ user_id: ME, job_id: JOB })])
    expect(db.tables.asset_favorites).toHaveLength(0)
    expect(await stateOf(MADE, JOB)).toBe(true)
  })

  it("a file whose job is in the Trash gets its own star, and then reads as favorited", async () => {
    expect(await setFileFavorite(ME, IN_TRASH, true)).toEqual({ kind: "ok", favorited: true, jobId: TRASHED_JOB })
    expect(db.tables.gallery_favorites).toEqual([])
    expect(db.tables.asset_favorites).toEqual([expect.objectContaining({ user_id: ME, asset_id: IN_TRASH })])
    expect(await stateOf(IN_TRASH, TRASHED_JOB)).toBe(true)
  })

  it("a wanted state is set without reading the current one (never a toggle)", async () => {
    await setFileFavorite(ME, MADE, true)
    await setFileFavorite(ME, UPLOAD, false)
    expect(db.ops.filter((o) => o.startsWith("rpc") || o === "select gallery_favorites")).toEqual([])
  })

  it("setting the state it already has keeps it (idempotent both ways)", async () => {
    await setFileFavorite(ME, MADE, true)
    expect(await setFileFavorite(ME, MADE, true)).toMatchObject({ favorited: true })
    expect(db.tables.gallery_favorites).toHaveLength(1)
    expect(await setFileFavorite(ME, UPLOAD, false)).toMatchObject({ favorited: false })
    expect(await setFileFavorite(ME, UPLOAD, false)).toMatchObject({ favorited: false })
  })

  it("two stars at once both end starred — neither removes the other's (the toggle race)", async () => {
    const results = await Promise.all([setFileFavorite(ME, MADE, true), setFileFavorite(ME, MADE, true)])
    expect(results).toEqual([
      { kind: "ok", favorited: true, jobId: JOB },
      { kind: "ok", favorited: true, jobId: JOB },
    ])
    expect(db.tables.gallery_favorites).toHaveLength(1)
    const uploads = await Promise.all([setFileFavorite(ME, UPLOAD, true), setFileFavorite(ME, UPLOAD, true)])
    expect(uploads.every((r) => r.kind === "ok" && r.favorited)).toBe(true)
    expect(db.tables.asset_favorites).toHaveLength(1)
    expect(await stateOf(UPLOAD, null)).toBe(true)
  })

  it("a star that lands from another call while this one runs is kept, never toggled off", async () => {
    // The window a read-then-toggle lost: this call has looked the file up,
    // another call stars the job, then this call writes. A toggle would see the
    // other call's row and delete it; the explicit add answers 23505 = starred.
    db.concurrent = () => {
      db.tables.gallery_favorites = [{ id: "other-call", user_id: ME, job_id: JOB }]
    }
    expect(await setFileFavorite(ME, MADE, true)).toEqual({ kind: "ok", favorited: true, jobId: JOB })
    expect(db.tables.gallery_favorites).toEqual([expect.objectContaining({ id: "other-call", user_id: ME, job_id: JOB })])
  })

  it("an unstar that lands from another call while this one runs stays unstarred", async () => {
    db.tables.gallery_favorites = [{ id: "g1", user_id: ME, job_id: JOB }]
    db.concurrent = () => {
      db.tables.gallery_favorites = []
    }
    expect(await setFileFavorite(ME, MADE, false)).toEqual({ kind: "ok", favorited: false, jobId: JOB })
    expect(db.tables.gallery_favorites).toEqual([])
  })

  it("two unstars at once both end unstarred", async () => {
    db.tables.gallery_favorites = [{ id: "g1", user_id: ME, job_id: JOB }]
    const results = await Promise.all([setFileFavorite(ME, MADE, false), setFileFavorite(ME, MADE, false)])
    expect(results.every((r) => r.kind === "ok" && !r.favorited)).toBe(true)
    expect(db.tables.gallery_favorites).toEqual([])
  })

  it("unstarring clears both the job's favorite and the file's own star", async () => {
    db.tables.gallery_favorites = [{ id: "g1", user_id: ME, job_id: JOB }]
    db.tables.asset_favorites = [{ id: "f1", user_id: ME, asset_id: MADE }]
    expect(await setFileFavorite(ME, MADE, false)).toMatchObject({ favorited: false })
    expect(db.tables.gallery_favorites).toEqual([])
    expect(db.tables.asset_favorites).toEqual([])
  })

  it("a shared library item may be starred; another person's private file is not found", async () => {
    expect(await setFileFavorite(ME, SHARED, true)).toMatchObject({ kind: "ok", favorited: true })
    expect(await setFileFavorite(ME, PRIVATE, true)).toEqual({ kind: "not_found" })
    expect(await setFileFavorite(ME, "00000000-0000-4000-8000-0000000000ff", true)).toEqual({ kind: "not_found" })
  })

  describe("before migration 688 reaches the database", () => {
    beforeEach(() => setFavoritesTablesPresentForTests(false))

    it("a generation still stars on its job", async () => {
      expect(await setFileFavorite(ME, MADE, true)).toMatchObject({ kind: "ok", favorited: true })
    })

    it("an upload cannot be starred yet", async () => {
      expect(await setFileFavorite(ME, UPLOAD, true)).toEqual({ kind: "not_available" })
    })

    it("the flag reads the job side alone, page-bounded, and never names 688's tables or functions", async () => {
      db.missing.add("asset_favorites")
      db.missingFunctions = true
      db.tables.gallery_favorites = [
        { id: "g1", user_id: ME, job_id: JOB },
        { id: "g2", user_id: ME, job_id: TRASHED_JOB },
      ]
      const state = await favoriteStateOfFiles(ME, [
        { id: UPLOAD, job_id: null },
        { id: MADE, job_id: JOB },
        { id: IN_TRASH, job_id: TRASHED_JOB },
      ])
      expect([...state]).toEqual([[UPLOAD, false], [MADE, true], [IN_TRASH, false]])
      expect(db.ops).toEqual(["select gallery_favorites", "select jobs"])
    })
  })

  it("a function missing after all (the probe was wrong) falls back to the job side", async () => {
    db.missingFunctions = true
    db.tables.gallery_favorites = [{ id: "g1", user_id: ME, job_id: JOB }]
    expect(await stateOf(MADE, JOB)).toBe(true)
    expect(await stateOf(UPLOAD, null)).toBe(false)
  })

  it("a table missing after all reads as no stars, forgets the tables, and an upload's star is not_available", async () => {
    db.missing.add("asset_favorites")
    expect(await setFileFavorite(ME, UPLOAD, true)).toEqual({ kind: "not_available" })
    expect(favoritesTablesPresent()).toBe(false)
  })
})

describe("isMissingFavoritesSchema", () => {
  it("is a missing table or a missing function, nothing else", () => {
    expect(isMissingFavoritesSchema({ code: "PGRST202", message: "Could not find the function" })).toBe(true)
    expect(isMissingFavoritesSchema({ code: "42883", message: "function does not exist" })).toBe(true)
    expect(isMissingFavoritesSchema({ code: "PGRST205" })).toBe(true)
    expect(isMissingFavoritesSchema({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false)
    expect(isMissingFavoritesSchema(null)).toBe(false)
  })
})

/**
 * The versioned trend store (ee/lib/trends/store.ts).
 *
 * What must hold (Review Focus 3): a published version is never edited —
 * saving a trend whose draft IS its published version writes a NEW version
 * and moves the draft pointer, leaving the published row untouched; a draft
 * that was never published is edited in place; unpublishing keeps the
 * published pointer (so the next save still copies); the catalog lists only
 * published trends, in (sort_order, id) order, with each trend's PUBLISHED
 * version's data; every write to `trends` bumps `updated_at`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { argOf, has, type QueryResult, type RecordedQuery } from "../../../../lib/__tests__/fake-supabase-query.js"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  respond: null as null | ((q: RecordedQuery) => QueryResult),
}))

vi.mock("../../../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../../../lib/__tests__/fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log, (q) => db.respond!(q)) } }
})

import {
  ORPHAN_VERSION_MIN_AGE_MS,
  createTrend,
  DraftConflictError,
  getDraftState,
  favoriteIds,
  listAllTrends,
  TrendSlugTakenError,
  updateTrendMeta,
  getTrendBySlug,
  getVersion,
  InvalidTrendCursorError,
  listPublished,
  publish,
  saveDraft,
  setFavorite,
  TrendNotFoundError,
  TrendsUnavailableError,
  unpublish,
  archive,
  restore,
  attachDisplayCopy,
  DisplayAttachConflictError,
  listVersionsLackingDisplay,
  attachPreviewClip,
  PreviewClipAttachConflictError,
  listVersionsLackingPreviewClip,
} from "../store.js"
import type { TrendPreviewClip, TrendVersionData } from "../types.js"

const T1 = "00000000-0000-4000-8000-0000000000a1"
const T2 = "00000000-0000-4000-8000-0000000000a2"
const T3 = "00000000-0000-4000-8000-0000000000a3"
const T4 = "00000000-0000-4000-8000-0000000000a4"
const USER = "00000000-0000-4000-8000-000000000001"

const DATA: TrendVersionData = {
  name: { en: "Dance off" },
  source: { videoUrl: "https://cdn.example.com/src.mp4", durationSec: 12 },
  previewStart: 0,
  slots: [{ key: "dancer", label: { en: "Dancer" }, kind: "person", required: true, roleName: "the dancer" }],
  references: [],
  examples: [],
}

function trendRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: T1,
    slug: "dance-off",
    status: "published",
    tags: ["dance"],
    badges: ["new"],
    sort_order: 0,
    draft_version: 1,
    published_version: 1,
    created_at: "2026-10-20T10:00:00+00:00",
    updated_at: "2026-10-20T10:00:00+00:00",
    ...over,
  }
}

const ok = (data: unknown): QueryResult => ({ data, error: null })

function queries(table: string, op?: string): RecordedQuery[] {
  return db.log.filter((q) => q.table === table && (!op || argOf(q, op)))
}

beforeEach(() => {
  db.log.length = 0
  db.respond = null
})

describe("getTrendBySlug / getVersion", () => {
  it("maps the row to camelCase, null on a miss", async () => {
    db.respond = () => ok(trendRow({ draft_version: 2, published_version: 1, sort_order: 5 }))
    expect(await getTrendBySlug("dance-off")).toEqual({
      id: T1, slug: "dance-off", status: "published", tags: ["dance"], badges: ["new"], sortOrder: 5,
      draftVersion: 2, publishedVersion: 1,
      createdAt: "2026-10-20T10:00:00+00:00", updatedAt: "2026-10-20T10:00:00+00:00",
    })
    expect(has(queries("trends")[0], "eq", "slug", "dance-off")).toBe(true)

    db.respond = () => ok(null)
    expect(await getTrendBySlug("nope")).toBeNull()
  })

  it("reads one version's data", async () => {
    db.respond = () => ok({ data: DATA })
    expect(await getVersion(T1, 3)).toEqual(DATA)
    const q = queries("trend_versions")[0]
    expect(has(q, "eq", "trend_id", T1) && has(q, "eq", "version", 3)).toBe(true)
  })

  it("throws on a database error", async () => {
    db.respond = () => ({ data: null, error: { message: "boom" } })
    await expect(getTrendBySlug("x")).rejects.toThrow(/boom/)
  })

  it.each(["42P01", "PGRST205"])("a missing table (%s) is TrendsUnavailableError — staging runs ahead of migration 549", async (code) => {
    db.respond = () => ({ data: null, error: { code, message: 'relation "public.trends" does not exist' } })
    await expect(getTrendBySlug("x")).rejects.toBeInstanceOf(TrendsUnavailableError)
    await expect(listPublished({ limit: 10 })).rejects.toBeInstanceOf(TrendsUnavailableError)
    await expect(favoriteIds(USER, [T1])).rejects.toBeInstanceOf(TrendsUnavailableError)
  })
})

describe("saveDraft", () => {
  it("copies on write: draft 2 = published 2 → writes version 3, moves draft_version to 3, leaves version 2 untouched", async () => {
    db.respond = (q) => {
      if (q.table === "trends" && argOf(q, "update")) return ok([{ id: T1 }])
      if (q.table === "trends") return ok(trendRow({ draft_version: 2, published_version: 2 }))
      return ok([{ version: 3 }])
    }
    expect(await saveDraft(T1, DATA)).toEqual({ version: 3, revision: expect.any(String) })

    const versionWrites = db.log.filter((q) => q.table === "trend_versions")
    expect(versionWrites).toHaveLength(1)
    expect(argOf(versionWrites[0], "insert")).toEqual([{ trend_id: T1, version: 3, data: DATA, revision: expect.any(String) }])
    // Nothing ever touches version 2.
    expect(db.log.some((q) => q.table === "trend_versions" && has(q, "eq", "version", 2))).toBe(false)

    const bump = queries("trends", "update")[0]
    const patch = argOf(bump, "update")![0] as Record<string, unknown>
    expect(patch.draft_version).toBe(3)
    expect(typeof patch.updated_at).toBe("string")
    expect(patch).not.toHaveProperty("published_version")
    // Guarded on the version it read, so a concurrent save cannot skip one.
    expect(has(bump, "eq", "id", T1) && has(bump, "eq", "draft_version", 2)).toBe(true)

    // The version row is written BEFORE the pointer moves to it.
    expect(db.log.indexOf(versionWrites[0])).toBeLessThan(db.log.indexOf(bump))
  })

  it("copy-on-write reuses an existing, never-published version + 1 row (23505) instead of failing forever", async () => {
    db.respond = (q) => {
      if (q.table === "trends" && argOf(q, "update")) return ok([{ id: T1 }])
      if (q.table === "trends") return ok(trendRow({ draft_version: 2, published_version: 2 }))
      if (argOf(q, "insert")) return { data: null, error: { code: "23505", message: "duplicate key" } }
      return ok([{ version: 3 }])
    }
    expect(await saveDraft(T1, DATA)).toEqual({ version: 3, revision: expect.any(String) })
    const reuse = queries("trend_versions", "update")[0]
    expect(argOf(reuse, "update")).toEqual([{ data: DATA, revision: expect.any(String) }])
    expect(has(reuse, "eq", "version", 3) && has(reuse, "is", "published_at", null)).toBe(true)
    expect(argOf(queries("trends", "update")[0], "update")![0]).toMatchObject({ draft_version: 3 })
  })

  it("edits a never-published draft in place", async () => {
    db.respond = (q) => {
      if (q.table === "trends" && argOf(q, "update")) return ok([{ id: T1 }])
      if (q.table === "trends") return ok(trendRow({ status: "draft", draft_version: 1, published_version: null }))
      return ok([{ version: 1 }])
    }
    expect(await saveDraft(T1, DATA)).toEqual({ version: 1, revision: expect.any(String) })

    const write = queries("trend_versions")[0]
    expect(argOf(write, "update")).toEqual([{ data: DATA, revision: expect.any(String) }])
    expect(has(write, "eq", "trend_id", T1) && has(write, "eq", "version", 1)).toBe(true)
    // Never a row that has been published (published_at set) — not even one published since the read.
    expect(has(write, "is", "published_at", null)).toBe(true)
    expect(argOf(write, "insert")).toBeUndefined()
    expect(argOf(write, "upsert")).toBeUndefined()

    const touch = argOf(queries("trends", "update")[0], "update")![0] as Record<string, unknown>
    expect(Object.keys(touch)).toEqual(["updated_at"])
  })

  it("edits a draft that is ahead of the published version in place", async () => {
    db.respond = (q) => {
      if (q.table === "trends" && argOf(q, "update")) return ok([{ id: T1 }])
      if (q.table === "trends") return ok(trendRow({ draft_version: 3, published_version: 2 }))
      return ok([{ version: 3 }])
    }
    expect(await saveDraft(T1, DATA)).toEqual({ version: 3, revision: expect.any(String) })
    const write = queries("trend_versions")[0]
    expect(argOf(write, "update")).toBeDefined()
    expect(has(write, "eq", "version", 3)).toBe(true)
  })

  it("throws when the draft's version row is missing (no silent no-op)", async () => {
    db.respond = (q) => {
      if (q.table === "trends") return ok(trendRow({ draft_version: 1, published_version: null }))
      return argOf(q, "update") ? ok([]) : ok(null)
    }
    await expect(saveDraft(T1, DATA)).rejects.toThrow(/draft version 1/)
    expect(queries("trends", "update")).toHaveLength(0)
  })

  it("copies forward from a draft row that was stamped by a publish that never moved the pointer", async () => {
    db.respond = (q) => {
      if (q.table === "trends" && argOf(q, "update")) return ok([{ id: T1 }])
      if (q.table === "trends") return ok(trendRow({ status: "draft", draft_version: 3, published_version: 2 }))
      if (argOf(q, "update")) return ok([]) // v3 is frozen: the guard refuses it
      if (argOf(q, "insert")) return ok(null)
      return ok({ published_at: "2026-10-20T11:00:00+00:00" })
    }
    expect(await saveDraft(T1, DATA)).toEqual({ version: 4, revision: expect.any(String) })
    expect(argOf(queries("trend_versions", "insert")[0], "insert")).toEqual([{ trend_id: T1, version: 4, data: DATA, revision: expect.any(String) }])
    const bump = queries("trends", "update")[0]
    expect(argOf(bump, "update")![0]).toMatchObject({ draft_version: 4 })
    expect(has(bump, "eq", "draft_version", 3)).toBe(true)
  })

  it("throws TrendNotFoundError for an unknown trend", async () => {
    db.respond = () => ok(null)
    await expect(saveDraft(T1, DATA)).rejects.toBeInstanceOf(TrendNotFoundError)
  })

  it("re-reads and retries when a concurrent save moved the draft first", async () => {
    let reads = 0
    db.respond = (q) => {
      if (q.table === "trends" && argOf(q, "update")) {
        // First pointer move loses the race; the second is against the new draft.
        return has(q, "eq", "draft_version", 2) ? ok([]) : ok([{ id: T1 }])
      }
      if (q.table === "trends") {
        reads++
        return ok(reads === 1 ? trendRow({ draft_version: 2, published_version: 2 }) : trendRow({ draft_version: 3, published_version: 2 }))
      }
      return ok([{ version: 3 }])
    }
    expect(await saveDraft(T1, DATA)).toEqual({ version: 3, revision: expect.any(String) })
    expect(reads).toBe(2)
  })
})

describe("publish / unpublish", () => {
  it("publish points published_version at the draft and stamps that version's published_at", async () => {
    db.respond = (q) => {
      if (q.table === "trends" && argOf(q, "update")) return ok([{ id: T1 }])
      if (q.table === "trends") return ok(trendRow({ status: "draft", draft_version: 3, published_version: 2 }))
      return ok([{ version: 3 }])
    }
    await publish(T1)

    const stamp = queries("trend_versions", "update")[0]
    const stampPatch = argOf(stamp, "update")![0] as Record<string, unknown>
    expect(typeof stampPatch.published_at).toBe("string")
    expect(has(stamp, "eq", "trend_id", T1) && has(stamp, "eq", "version", 3)).toBe(true)

    const flip = queries("trends", "update")[0]
    const patch = argOf(flip, "update")![0] as Record<string, unknown>
    expect(patch).toMatchObject({ status: "published", published_version: 3 })
    expect(typeof patch.updated_at).toBe("string")
    expect(has(flip, "eq", "draft_version", 3)).toBe(true)
  })

  it("publish refuses when the draft's version row does not exist, without moving the pointer", async () => {
    db.respond = (q) => {
      if (q.table === "trends") return ok(trendRow({ status: "draft", draft_version: 1, published_version: null }))
      return ok([])
    }
    await expect(publish(T1)).rejects.toThrow(/version 1/)
    expect(queries("trends", "update")).toHaveLength(0)
  })

  it("unpublish flips status only and KEEPS published_version", async () => {
    db.respond = (q) => {
      if (q.table === "trends" && argOf(q, "update")) return ok([{ id: T1 }])
      return ok(trendRow({ draft_version: 2, published_version: 2 }))
    }
    await unpublish(T1)
    const patch = argOf(queries("trends", "update")[0], "update")![0] as Record<string, unknown>
    expect(Object.keys(patch).sort()).toEqual(["status", "updated_at"])
    expect(patch.status).toBe("unpublished")
  })

  it("throws TrendNotFoundError for an unknown trend", async () => {
    db.respond = () => ok(null)
    await expect(publish(T1)).rejects.toBeInstanceOf(TrendNotFoundError)
    await expect(unpublish(T1)).rejects.toBeInstanceOf(TrendNotFoundError)
  })
})

describe("archive / restore", () => {
  const patchOf = () => argOf(queries("trends", "update")[0]!, "update")![0] as Record<string, unknown>

  it("archive sets status only, from any status, guarded against a concurrent archive", async () => {
    db.respond = (q) => (q.table === "trends" && argOf(q, "update") ? ok([{ id: T1 }]) : ok(trendRow({ status: "published", published_version: 1 })))
    await archive(T1)
    expect(Object.keys(patchOf()).sort()).toEqual(["status", "updated_at"])
    expect(patchOf().status).toBe("archived")
    expect(has(queries("trends", "update")[0]!, "neq", "status", "archived")).toBe(true)
  })

  it("archive of an archived trend writes nothing", async () => {
    db.respond = () => ok(trendRow({ status: "archived" }))
    await archive(T1)
    expect(queries("trends", "update")).toEqual([])
  })

  it("restore goes to unpublished when the trend was ever published, else to draft, only from archived", async () => {
    db.respond = (q) => (q.table === "trends" && argOf(q, "update") ? ok([{ id: T1 }]) : ok(trendRow({ status: "archived", published_version: 2 })))
    await restore(T1)
    expect(patchOf().status).toBe("unpublished")
    expect(has(queries("trends", "update")[0]!, "eq", "status", "archived")).toBe(true)

    db.log.length = 0
    db.respond = (q) => (q.table === "trends" && argOf(q, "update") ? ok([{ id: T1 }]) : ok(trendRow({ status: "archived", published_version: null })))
    await restore(T1)
    expect(patchOf().status).toBe("draft")
  })

  it("restore of a trend that is not archived writes nothing", async () => {
    db.respond = () => ok(trendRow({ status: "published", published_version: 1 }))
    await restore(T1)
    expect(queries("trends", "update")).toEqual([])
  })
})

describe("listPublished", () => {
  const V1 = { ...DATA, name: { en: "T1 v1" } }
  const V3 = { ...DATA, name: { en: "T2 v3" } }

  function catalog(pageRows: Record<string, unknown>[]) {
    return (q: RecordedQuery): QueryResult => {
      if (q.table === "trends") return ok(pageRows)
      if (q.table === "trend_versions") return ok([
        { trend_id: T1, version: 1, data: V1 },
        { trend_id: T2, version: 3, data: V3 },
      ])
      return ok([])
    }
  }

  it("lists only published trends in (sort_order, id) order, with the PUBLISHED version's data", async () => {
    db.respond = catalog([
      trendRow({ id: T1, sort_order: 0, draft_version: 2, published_version: 1 }),
      trendRow({ id: T2, slug: "b", sort_order: 1, draft_version: 3, published_version: 3 }),
    ])
    const { rows, next } = await listPublished({ limit: 10 })

    const page = queries("trends")[0]
    expect(has(page, "eq", "status", "published")).toBe(true)
    expect(has(page, "order", "sort_order", { ascending: true })).toBe(true)
    expect(has(page, "order", "id", { ascending: true })).toBe(true)
    expect(has(page, "limit", 11)).toBe(true)

    // Versions are fetched by exact (trend, published_version) pairs — never draft 2.
    const versions = queries("trend_versions")[0]
    expect(argOf(versions, "or")![0]).toBe(`and(trend_id.eq.${T1},version.eq.1),and(trend_id.eq.${T2},version.eq.3)`)

    expect(rows.map((r) => [r.id, r.data.name.en])).toEqual([[T1, "T1 v1"], [T2, "T2 v3"]])
    expect(rows[0].publishedVersion).toBe(1)
    expect(next).toBeNull()
  })

  it("pages with a keyset cursor on (sort_order, id)", async () => {
    db.respond = catalog([
      trendRow({ id: T1, sort_order: 0 }),
      trendRow({ id: T2, sort_order: 4, published_version: 3, draft_version: 3 }),
      trendRow({ id: T3, sort_order: 9 }),
    ])
    const first = await listPublished({ limit: 2 })
    expect(first.rows.map((r) => r.id)).toEqual([T1, T2])
    expect(first.next).toEqual(expect.any(String))

    db.log.length = 0
    db.respond = catalog([])
    await listPublished({ limit: 2, cursor: first.next! })
    expect(argOf(queries("trends")[0], "or")![0]).toBe(`sort_order.gt.4,and(sort_order.eq.4,id.gt.${T2})`)
  })

  it("rejects a cursor it did not issue", async () => {
    db.respond = catalog([])
    await expect(listPublished({ limit: 2, cursor: "not-a-cursor" })).rejects.toBeInstanceOf(InvalidTrendCursorError)
    const forged = Buffer.from(JSON.stringify([1, "x'); drop"])).toString("base64url")
    await expect(listPublished({ limit: 2, cursor: forged })).rejects.toBeInstanceOf(InvalidTrendCursorError)
  })

  it("filters by tag with tags @> [tag]", async () => {
    db.respond = catalog([])
    await listPublished({ limit: 5, tag: "dance" })
    expect(has(queries("trends")[0], "contains", "tags", '{"dance"}')).toBe(true)
  })

  it("sends a tag as ONE quoted array element, whatever it holds", async () => {
    db.respond = catalog([])
    await listPublished({ limit: 5, tag: 'a,"b}\\' })
    expect(argOf(queries("trends")[0], "contains")).toEqual(["tags", '{"a,\\"b}\\\\"}'])
  })

  it("favoritesOf limits the page to the user's favorites, and an empty list skips the catalog query", async () => {
    db.respond = (q) => (q.table === "trend_favorites" ? ok([{ trend_id: T1 }]) : catalog([trendRow()])(q))
    await listPublished({ limit: 5, favoritesOf: USER })
    expect(has(queries("trend_favorites")[0], "eq", "user_id", USER)).toBe(true)
    expect(has(queries("trends")[0], "in", "id", [T1])).toBe(true)

    db.log.length = 0
    db.respond = (q) => (q.table === "trend_favorites" ? ok([]) : catalog([trendRow()])(q))
    expect(await listPublished({ limit: 5, favoritesOf: USER })).toEqual({ rows: [], next: null })
    expect(queries("trends")).toHaveLength(0)
  })

  it("q matches a published name in any locale or an exact tag, before paging", async () => {
    db.respond = (q) => {
      if (q.table === "trend_versions" && argOf(q, "ilike")) {
        return ok([
          { trend_id: T1, version: 1, name: { en: "Dance off", he: "ריקוד" } }, // published version: kept
          { trend_id: T2, version: 4, name: { en: "Dance battle" } }, // a draft of T2 (published is 3): dropped
          { trend_id: T3, version: 1, name: { en: "Glance" } }, // a database hit no name value really contains: dropped
        ])
      }
      if (q.table === "trends" && argOf(q, "contains")) return ok([{ id: T4 }]) // the exact-tag hit
      if (q.table === "trends" && argOf(q, "in") && !argOf(q, "limit")) {
        return ok([{ id: T1, published_version: 1 }, { id: T2, published_version: 3 }])
      }
      return catalog([])(q)
    }
    await listPublished({ limit: 5, q: "ריקוד" })

    const nameHits = queries("trend_versions", "ilike")[0]
    expect(argOf(nameHits, "ilike")).toEqual(["data->>name", "%ריקוד%"])
    const page = db.log.filter((q) => q.table === "trends" && argOf(q, "limit"))[0]
    expect(has(queries("trends", "contains")[0], "contains", "tags", '{"ריקוד"}')).toBe(true)
    expect((argOf(page, "in")![1] as string[]).sort()).toEqual([T1, T4].sort())
  })

  it("escapes LIKE wildcards in q", async () => {
    db.respond = () => ok([])
    await listPublished({ limit: 5, q: "50%_off\\" })
    expect(argOf(queries("trend_versions", "ilike")[0], "ilike")![1]).toBe("%50\\%\\_off\\\\%")
  })
})

describe("favorites", () => {
  it("setFavorite on upserts (user_id, trend_id); off deletes exactly that pair", async () => {
    db.respond = () => ok(null)
    await setFavorite(USER, T1, true)
    const up = queries("trend_favorites")[0]
    expect(argOf(up, "upsert")).toEqual([{ user_id: USER, trend_id: T1 }, { onConflict: "user_id,trend_id", ignoreDuplicates: true }])

    await setFavorite(USER, T1, false)
    const del = queries("trend_favorites")[1]
    expect(argOf(del, "delete")).toBeDefined()
    expect(has(del, "eq", "user_id", USER) && has(del, "eq", "trend_id", T1)).toBe(true)
  })

  it("favoriteIds returns the user's favorites among the given trends", async () => {
    db.respond = () => ok([{ trend_id: T2 }])
    expect(await favoriteIds(USER, [T1, T2])).toEqual(new Set([T2]))
    const q = queries("trend_favorites")[0]
    expect(has(q, "eq", "user_id", USER) && has(q, "in", "trend_id", [T1, T2])).toBe(true)
  })

  it("favoriteIds of no trends asks nothing", async () => {
    expect(await favoriteIds(USER, [])).toEqual(new Set())
    expect(db.log).toHaveLength(0)
  })
})

describe("admin writes", () => {
  it("createTrend inserts the trend as a draft at version 1, then its version 1 row", async () => {
    db.respond = (q) => (q.table === "trends" ? ok({ id: T1 }) : ok(null))
    expect(await createTrend({ slug: "dance-off", data: DATA, createdBy: USER })).toEqual({ id: T1 })
    expect(argOf(queries("trends", "insert")[0], "insert")).toEqual([{ slug: "dance-off", status: "draft", draft_version: 1, created_by: USER }])
    expect(argOf(queries("trend_versions", "insert")[0], "insert")).toEqual([{ trend_id: T1, version: 1, data: DATA }])
  })

  it("createTrend: a taken slug is TrendSlugTakenError, and nothing else is written", async () => {
    db.respond = (q) => (q.table === "trends" ? { data: null, error: { code: "23505", message: "duplicate" } } : ok(null))
    await expect(createTrend({ slug: "dance-off", data: DATA })).rejects.toBeInstanceOf(TrendSlugTakenError)
    expect(queries("trend_versions")).toHaveLength(0)
  })

  it("createTrend removes the trend row again when its version 1 cannot be written", async () => {
    db.respond = (q) => {
      if (q.table === "trend_versions") return { data: null, error: { code: "XX000", message: "boom" } }
      return ok({ id: T1 })
    }
    await expect(createTrend({ slug: "dance-off", data: DATA })).rejects.toThrow(/version 1/)
    const undo = queries("trends", "delete")[0]
    expect(undo && has(undo, "eq", "id", T1)).toBe(true)
  })

  it("listAllTrends lists every status in (sort_order, id) order, each with its DRAFT version's data", async () => {
    db.respond = (q) => {
      if (q.table === "trends") {
        return ok([trendRow({ status: "draft", draft_version: 1, published_version: null }), trendRow({ id: T2, slug: "b", draft_version: 3, published_version: 2 })])
      }
      return ok([{ trend_id: T1, version: 1, data: DATA }, { trend_id: T2, version: 3, data: { ...DATA, name: { en: "B v3" } } }])
    }
    const rows = await listAllTrends()
    expect(rows.map((r) => [r.id, r.draft?.name.en])).toEqual([[T1, "Dance off"], [T2, "B v3"]])
    const list = queries("trends")[0]
    expect(argOf(list, "eq")).toBeUndefined() // no status filter
    expect(has(list, "order", "sort_order", { ascending: true }) && has(list, "order", "id", { ascending: true })).toBe(true)
    expect(argOf(queries("trend_versions")[0], "or")).toEqual([`and(trend_id.eq.${T1},version.eq.1),and(trend_id.eq.${T2},version.eq.3)`])
  })

  it("updateTrendMeta writes only the given fields plus updated_at; null for an unknown trend", async () => {
    db.respond = () => ok(trendRow({ sort_order: 7 }))
    const row = await updateTrendMeta(T1, { sortOrder: 7, badges: ["trending"] })
    expect(row?.sortOrder).toBe(7)
    const q = queries("trends", "update")[0]
    const patch = argOf(q, "update")![0] as Record<string, unknown>
    expect(Object.keys(patch).sort()).toEqual(["badges", "sort_order", "updated_at"])
    expect(has(q, "eq", "id", T1)).toBe(true)

    db.respond = () => ok(null)
    expect(await updateTrendMeta(T1, { tags: [] })).toBeNull()
    db.respond = () => ({ data: null, error: { code: "23505", message: "duplicate" } })
    await expect(updateTrendMeta(T1, { slug: "taken" })).rejects.toBeInstanceOf(TrendSlugTakenError)
  })
})

describe("draft revisions (optimistic concurrency)", () => {
  it("getDraftState reads the draft row's data and revision", async () => {
    db.respond = (q) =>
      q.table === "trends" ? ok(trendRow({ draft_version: 2, published_version: 1 })) : ok({ data: DATA, revision: "r-2" })
    const state = await getDraftState(T1)
    expect(state).toMatchObject({ data: DATA, revision: "r-2", trend: { id: T1, draftVersion: 2 } })
    const read = queries("trend_versions")[0]
    expect(has(read, "eq", "version", 2) && has(read, "select", "data, revision")).toBe(true)
  })

  it("saveDraft with expectedRevision writes only while the row is still at that revision, and gives it a new one", async () => {
    db.respond = (q) => {
      if (q.table === "trends" && argOf(q, "update")) return ok([{ id: T1 }])
      if (q.table === "trends") return ok(trendRow({ status: "draft", draft_version: 1, published_version: null }))
      return ok([{ version: 1 }])
    }
    const saved = await saveDraft(T1, DATA, { expectedRevision: "r-1" })
    const write = queries("trend_versions", "update")[0]
    expect(has(write, "eq", "revision", "r-1") && has(write, "is", "published_at", null)).toBe(true)
    const patch = argOf(write, "update")![0] as { revision: string }
    expect(patch.revision).not.toBe("r-1")
    expect(saved).toEqual({ version: 1, revision: patch.revision })
  })

  it("saveDraft refuses (DraftConflictError) when the draft was written since, and touches nothing else", async () => {
    db.respond = (q) => {
      if (q.table === "trends") return ok(trendRow({ status: "draft", draft_version: 1, published_version: null }))
      if (argOf(q, "update")) return ok([]) // the guarded write matched no row
      return ok({ published_at: null, revision: "r-2" })
    }
    await expect(saveDraft(T1, DATA, { expectedRevision: "r-1" })).rejects.toBeInstanceOf(DraftConflictError)
    expect(queries("trends", "update")).toHaveLength(0)
    expect(queries("trend_versions", "insert")).toHaveLength(0)
  })

  it("saveDraft on a published draft copies forward only from the revision the caller read", async () => {
    db.respond = (q) => {
      if (q.table === "trends") return ok(trendRow({ draft_version: 2, published_version: 2 }))
      return ok({ published_at: "2026-10-20T10:00:00+00:00", revision: "r-published" })
    }
    await expect(saveDraft(T1, DATA, { expectedRevision: "r-old" })).rejects.toBeInstanceOf(DraftConflictError)
    expect(queries("trend_versions", "insert")).toHaveLength(0)
  })

  it("publish with expected stamps only the checked revision; a changed draft is DraftConflictError and nothing moves", async () => {
    db.respond = (q) => {
      if (q.table === "trends") return ok(trendRow({ status: "draft", draft_version: 1, published_version: null }))
      if (argOf(q, "update")) return ok([]) // the stamp's revision guard matched nothing
      return ok({ published_at: null, revision: "r-2" })
    }
    await expect(publish(T1, { version: 1, revision: "r-1" })).rejects.toBeInstanceOf(DraftConflictError)
    expect(has(queries("trend_versions", "update")[0], "eq", "revision", "r-1")).toBe(true)
    expect(queries("trends", "update")).toHaveLength(0)
  })

  it("publish with expected refuses a draft that moved to another version, without writing", async () => {
    db.respond = () => ok(trendRow({ status: "draft", draft_version: 2, published_version: 1 }))
    await expect(publish(T1, { version: 1, revision: "r-1" })).rejects.toBeInstanceOf(DraftConflictError)
    expect(db.log.some((q) => argOf(q, "update"))).toBe(false)
  })
})

describe("a guarded copy-forward never overwrites another writer's version + 1", () => {
  const OLD = new Date(Date.now() - ORPHAN_VERSION_MIN_AGE_MS - 60_000).toISOString()
  const FRESH = new Date().toISOString()

  /** Draft 1 = published 1 (revision r-pub); inserting version 2 hits 23505. */
  function published(pointerAfter: number, v2: Record<string, unknown> | null) {
    let trendReads = 0
    db.respond = (q) => {
      if (q.table === "trends" && argOf(q, "update")) return ok([{ id: T1 }])
      if (q.table === "trends") {
        trendReads++
        return ok(trendRow({ draft_version: trendReads === 1 ? 1 : pointerAfter, published_version: 1 }))
      }
      if (argOf(q, "insert")) return { data: null, error: { code: "23505", message: "duplicate key" } }
      if (argOf(q, "update")) return ok([{ version: 2 }])
      if (has(q, "eq", "version", 1)) return ok({ published_at: "2026-10-20T10:00:00+00:00", revision: "r-pub" })
      return ok(v2)
    }
  }

  const writesToV2 = () => queries("trend_versions", "update").filter((q) => has(q, "eq", "version", 2))

  it("23505 and the pointer already moved to version 2: DraftConflictError, no write to version 2", async () => {
    published(2, { revision: "r-a", published_at: null, created_at: FRESH })
    await expect(saveDraft(T1, DATA, { expectedRevision: "r-pub" })).rejects.toBeInstanceOf(DraftConflictError)
    expect(writesToV2()).toHaveLength(0)
    expect(queries("trends", "update")).toHaveLength(0)
  })

  it("23505 and a young version 2 (a writer between insert and pointer move): DraftConflictError, no write", async () => {
    published(1, { revision: "r-a", published_at: null, created_at: FRESH })
    await expect(saveDraft(T1, DATA, { expectedRevision: "r-pub" })).rejects.toBeInstanceOf(DraftConflictError)
    expect(writesToV2()).toHaveLength(0)
    expect(queries("trends", "update")).toHaveLength(0)
  })

  it("23505 and an orphaned version 2 (pointer still at 1, old, unpublished): reclaimed only by a revision-conditional update", async () => {
    published(1, { revision: "r-orphan", published_at: null, created_at: OLD })
    const saved = await saveDraft(T1, DATA, { expectedRevision: "r-pub" })
    expect(saved.version).toBe(2)
    const [reclaim] = writesToV2()
    expect(reclaim).toBeDefined()
    expect(has(reclaim!, "eq", "revision", "r-orphan")).toBe(true)
    expect(has(reclaim!, "is", "published_at", null)).toBe(true)
    expect(argOf(reclaim!, "lt")?.[0]).toBe("created_at")
    const patch = argOf(reclaim!, "update")![0] as Record<string, unknown>
    expect(patch).toMatchObject({ data: DATA, revision: saved.revision })
    expect(typeof patch.created_at).toBe("string")
    expect(has(queries("trends", "update")[0]!, "eq", "draft_version", 1)).toBe(true)
  })

  it("an orphan reclaim that loses its condition (another reclaimer won) is DraftConflictError and moves no pointer", async () => {
    published(1, { revision: "r-orphan", published_at: null, created_at: OLD })
    const base = db.respond!
    db.respond = (q) => (q.table === "trend_versions" && argOf(q, "update") ? ok([]) : base(q))
    await expect(saveDraft(T1, DATA, { expectedRevision: "r-pub" })).rejects.toBeInstanceOf(DraftConflictError)
    expect(queries("trends", "update")).toHaveLength(0)
  })

  it("a published version 2 is never reclaimed", async () => {
    published(1, { revision: "r-orphan", published_at: "2026-10-20T10:00:00+00:00", created_at: OLD })
    await expect(saveDraft(T1, DATA, { expectedRevision: "r-pub" })).rejects.toBeInstanceOf(DraftConflictError)
    expect(writesToV2()).toHaveLength(0)
  })
})

describe("attachDisplayCopy — the one write a published version may get (S7 backfill)", () => {
  const DISPLAY = { videoUrl: "https://cdn.example.com/display.mp4", posterUrl: "https://cdn.example.com/poster.png", width: 240, height: 320, durationSec: 12.04 }
  const REV = "11111111-1111-4111-8111-111111111111"
  // A published version with every kind of field, so "nothing else changed" means something.
  const FULL: TrendVersionData = {
    ...DATA,
    name: { en: "Dance off", he: "קרב ריקוד" },
    source: { videoUrl: "https://cdn.example.com/src.mov", durationSec: 12, width: 1080, height: 1920 },
    previewStart: 3,
    references: [{ url: "https://cdn.example.com/ref.png" }] as never,
    examples: [{ videoUrl: "https://cdn.example.com/ex.mp4", width: 1080, height: 1920, durationSec: 12, slots: {} }] as never,
  }

  it("writes data.source.display on a PUBLISHED row and nothing else: same data otherwise, no revision, no published_at", async () => {
    const before = structuredClone(FULL)
    db.respond = (q) => (argOf(q, "update") ? ok([{ version: 2 }]) : ok({ data: FULL, revision: REV, published_at: "2026-10-20T10:00:00+00:00" }))
    expect(await attachDisplayCopy(T1, 2, DISPLAY)).toBe("set")

    const write = queries("trend_versions", "update")
    expect(write).toHaveLength(1)
    const payload = argOf(write[0]!, "update")![0] as Record<string, unknown>
    expect(Object.keys(payload)).toEqual(["data"])
    const next = payload.data as TrendVersionData
    expect(next.source).toEqual({ ...before.source, display: DISPLAY })
    const { source: _a, ...restNext } = next
    const { source: _b, ...restBefore } = before
    expect(JSON.stringify(restNext)).toBe(JSON.stringify(restBefore))
    expect(JSON.stringify({ ...next.source, display: undefined })).toBe(JSON.stringify(before.source))
    // The caller's object is not mutated.
    expect(FULL).toEqual(before)

    // Guarded: the row read (its revision) and display still absent — never on published_at.
    expect(has(write[0]!, "eq", "trend_id", T1) && has(write[0]!, "eq", "version", 2)).toBe(true)
    expect(has(write[0]!, "eq", "revision", REV)).toBe(true)
    expect(has(write[0]!, "is", "data->source->>display", null)).toBe(true)
    expect(write[0]!.ops.some((op) => op.m === "is" && op.a[0] === "published_at")).toBe(false)
    expect(queries("trends", "update")).toHaveLength(0)
  })

  it("is 'already' and writes nothing when the version has a display copy", async () => {
    db.respond = () => ok({ data: { ...FULL, source: { ...FULL.source!, display: DISPLAY } }, revision: REV, published_at: null })
    expect(await attachDisplayCopy(T1, 2, { ...DISPLAY, videoUrl: "https://cdn.example.com/other.mp4" })).toBe("already")
    expect(queries("trend_versions", "update")).toHaveLength(0)
  })

  it("a guarded write that matched nothing re-reads: a display set meanwhile is 'already'", async () => {
    let reads = 0
    db.respond = (q) => {
      if (argOf(q, "update")) return ok([])
      reads += 1
      return reads === 1
        ? ok({ data: FULL, revision: REV, published_at: null })
        : ok({ data: { ...FULL, source: { ...FULL.source!, display: DISPLAY } }, revision: REV, published_at: null })
    }
    expect(await attachDisplayCopy(T1, 2, DISPLAY)).toBe("already")
    expect(queries("trend_versions", "update")).toHaveLength(1)
  })

  it("retries on a moved revision, then gives up with DisplayAttachConflictError", async () => {
    db.respond = (q) => (argOf(q, "update") ? ok([]) : ok({ data: FULL, revision: randomRevision(), published_at: null }))
    const err = await attachDisplayCopy(T1, 2, DISPLAY).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DisplayAttachConflictError)
    expect((err as DisplayAttachConflictError).reason).toBe("concurrent_write")
    expect(queries("trend_versions", "update")).toHaveLength(3)
  })

  it("refuses a copy made from another source clip than the row now has (the admin replaced it)", async () => {
    db.respond = () => ok({ data: FULL, revision: REV, published_at: null })
    const err = await attachDisplayCopy(T1, 2, DISPLAY, { sourceVideoUrl: "https://cdn.example.com/old.mov" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DisplayAttachConflictError)
    expect((err as DisplayAttachConflictError).reason).toBe("source_changed")
    expect(queries("trend_versions", "update")).toHaveLength(0)
  })

  it("a row gone (the trend deleted) or a source cleared since the listing is a conflict, never a write", async () => {
    db.respond = () => ok(null)
    const gone = await attachDisplayCopy(T1, 9, DISPLAY).catch((e: unknown) => e)
    expect(gone).toBeInstanceOf(DisplayAttachConflictError)
    expect((gone as DisplayAttachConflictError).reason).toBe("version_missing")
    expect((gone as Error).message).toMatch(/version 9/)
    db.respond = () => ok({ data: { ...FULL, source: null }, revision: REV, published_at: null })
    const cleared = await attachDisplayCopy(T1, 2, DISPLAY).catch((e: unknown) => e)
    expect(cleared).toBeInstanceOf(DisplayAttachConflictError)
    expect((cleared as DisplayAttachConflictError).reason).toBe("source_removed")
    expect(queries("trend_versions", "update")).toHaveLength(0)
  })

  it("throws (a plain error) for a copy that IS the source clip and a non-http(s) address", async () => {
    db.respond = () => ok({ data: FULL, revision: REV, published_at: null })
    await expect(attachDisplayCopy(T1, 2, { ...DISPLAY, videoUrl: FULL.source!.videoUrl })).rejects.toThrow(/own file/)
    // A storage without R2_PUBLIC_URL answers "/trends/…": never stored as a display address.
    const notHttp = await attachDisplayCopy(T1, 2, { ...DISPLAY, posterUrl: "/trends/x.png" }).catch((e: unknown) => e)
    expect((notHttp as Error).message).toMatch(/http\(s\)/)
    expect(notHttp).not.toBeInstanceOf(DisplayAttachConflictError)
    expect(queries("trend_versions", "update")).toHaveLength(0)
  })
})

function randomRevision(): string {
  return `00000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`
}

describe("listVersionsLackingDisplay", () => {
  const SRC = { videoUrl: "https://cdn.example.com/src.mp4", durationSec: 12 }
  it("lists every version (published and draft) with a source and no display copy, with its trend's slug", async () => {
    db.respond = (q) => {
      if (q.table === "trends") return ok([{ id: T1, slug: "dance-off" }, { id: T2, slug: "jump" }])
      return ok([
        { trend_id: T1, version: 1, published_at: "2026-10-20T10:00:00+00:00", source: SRC },
        { trend_id: T1, version: 2, published_at: null, source: SRC },
        // What the database filters should already drop — filtered again here.
        { trend_id: T2, version: 1, published_at: null, source: { ...SRC, display: { videoUrl: "x" } } },
        { trend_id: T2, version: 2, published_at: null, source: null },
        { trend_id: T3, version: 1, published_at: null, source: SRC },
      ])
    }
    expect(await listVersionsLackingDisplay()).toEqual([
      { trendId: T1, slug: "dance-off", version: 1, published: true, sourceVideoUrl: SRC.videoUrl },
      { trendId: T1, version: 2, slug: "dance-off", published: false, sourceVideoUrl: SRC.videoUrl },
      { trendId: T3, slug: null, version: 1, published: false, sourceVideoUrl: SRC.videoUrl },
    ])
    const q = queries("trend_versions")[0]!
    expect(has(q, "not", "data->>source", "is", null)).toBe(true)
    expect(has(q, "is", "data->source->>display", null)).toBe(true)
    expect(argOf(q, "update")).toBeUndefined()
  })

  it("reads every page before returning", async () => {
    const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ trend_id: T1, version: from + i + 1, published_at: null, source: SRC }))
    db.respond = (q) => {
      if (q.table === "trends") return ok([{ id: T1, slug: "dance-off" }])
      const [from] = argOf(q, "range") as [number, number]
      return ok(from === 0 ? page(0, 500) : page(500, 3))
    }
    expect(await listVersionsLackingDisplay()).toHaveLength(503)
    expect(queries("trend_versions")).toHaveLength(2)
  })
})

describe("attachPreviewClip — the second write a published version may get (preview clip backfill)", () => {
  const REV = "11111111-1111-4111-8111-111111111111"
  const CLIP: TrendPreviewClip = {
    videoUrl: "https://cdn.example.com/preview.mp4", durationSec: 5, width: 240, height: 320, frames: 150, sha256: "a".repeat(64),
    sourceVideoUrl: "https://cdn.example.com/src.mp4", startSec: 0, recipe: "1", madeAt: "2026-10-27T10:00:00.000Z",
  }
  const FULL: TrendVersionData = {
    ...DATA,
    name: { en: "Dance off", he: "קרב ריקוד" },
    source: { videoUrl: "https://cdn.example.com/src.mp4", durationSec: 12, width: 1080, height: 1920, display: { videoUrl: "https://cdn.example.com/d.mp4", posterUrl: "https://cdn.example.com/d.png", width: 1080, height: 1920, durationSec: 12 } },
    previewStart: 0,
    examples: [{ videoUrl: "https://cdn.example.com/ex.mp4", width: 1080, height: 1920, durationSec: 12, slots: {} }] as never,
  }

  it("writes data.previewClip on a PUBLISHED row and nothing else: same data otherwise, no revision, no published_at", async () => {
    const before = structuredClone(FULL)
    db.respond = (q) => (argOf(q, "update") ? ok([{ version: 2 }]) : ok({ data: FULL, revision: REV, published_at: "2026-10-20T10:00:00+00:00" }))
    expect(await attachPreviewClip(T1, 2, CLIP)).toBe("set")

    const write = queries("trend_versions", "update")
    expect(write).toHaveLength(1)
    const payload = argOf(write[0]!, "update")![0] as Record<string, unknown>
    expect(Object.keys(payload)).toEqual(["data"])
    const next = payload.data as TrendVersionData
    expect(next.previewClip).toEqual(CLIP)
    const { previewClip: _c, ...restNext } = next
    expect(JSON.stringify(restNext)).toBe(JSON.stringify(before))
    expect(FULL).toEqual(before)

    // Guarded: the row read (its revision) and the clip still absent — never on published_at.
    expect(has(write[0]!, "eq", "trend_id", T1) && has(write[0]!, "eq", "version", 2)).toBe(true)
    expect(has(write[0]!, "eq", "revision", REV)).toBe(true)
    expect(has(write[0]!, "is", "data->>previewClip", null)).toBe(true)
    expect(write[0]!.ops.some((op) => op.m === "is" && op.a[0] === "published_at")).toBe(false)
    expect(queries("trends", "update")).toHaveLength(0)
  })

  it("is 'already' and writes nothing when the version has a clip (the stored one wins: a run keeps editing the same bytes)", async () => {
    db.respond = () => ok({ data: { ...FULL, previewClip: { ...CLIP, videoUrl: "https://cdn.example.com/earlier.mp4" } }, revision: REV, published_at: null })
    expect(await attachPreviewClip(T1, 2, CLIP)).toBe("already")
    expect(queries("trend_versions", "update")).toHaveLength(0)
  })

  it("retries on a moved revision, then gives up with PreviewClipAttachConflictError", async () => {
    db.respond = (q) => (argOf(q, "update") ? ok([]) : ok({ data: FULL, revision: randomRevision(), published_at: null }))
    const err = await attachPreviewClip(T1, 2, CLIP).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PreviewClipAttachConflictError)
    expect((err as PreviewClipAttachConflictError).reason).toBe("concurrent_write")
    expect(queries("trend_versions", "update")).toHaveLength(3)
  })

  it("refuses a clip cut from another source, at another start, or for a row that offers no preview any more; a row gone is a conflict too", async () => {
    const reasonOf = async (data: TrendVersionData | null, clip = CLIP) => {
      db.respond = () => ok(data === null ? null : { data, revision: REV, published_at: null })
      const err = await attachPreviewClip(T1, 2, clip).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PreviewClipAttachConflictError)
      return (err as PreviewClipAttachConflictError).reason
    }
    expect(await reasonOf(FULL, { ...CLIP, sourceVideoUrl: "https://cdn.example.com/old.mp4" })).toBe("source_changed")
    expect(await reasonOf({ ...FULL, previewStart: 3 })).toBe("start_changed")
    expect(await reasonOf({ ...FULL, previewStart: null })).toBe("not_offered")
    expect(await reasonOf({ ...FULL, source: null })).toBe("not_offered")
    expect(await reasonOf(null)).toBe("version_missing")
    expect(queries("trend_versions", "update")).toHaveLength(0)
  })

  it("throws (a plain error) for a clip that IS the source clip and a non-http(s) address", async () => {
    db.respond = () => ok({ data: FULL, revision: REV, published_at: null })
    await expect(attachPreviewClip(T1, 2, { ...CLIP, videoUrl: FULL.source!.videoUrl })).rejects.toThrow(/own file/)
    const notHttp = await attachPreviewClip(T1, 2, { ...CLIP, faceMask: { url: "/trends/m.mp4", frames: 150, sha256: "b".repeat(64), sourceMaskUrl: "https://cdn.example.com/mask.mp4" } }).catch((e: unknown) => e)
    expect((notHttp as Error).message).toMatch(/http\(s\)/)
    expect(notHttp).not.toBeInstanceOf(PreviewClipAttachConflictError)
    expect(queries("trend_versions", "update")).toHaveLength(0)
  })
})

describe("listVersionsLackingPreviewClip", () => {
  const SRC = { videoUrl: "https://cdn.example.com/src.mp4", durationSec: 12 }
  const row = (trendId: string, version: number, published: boolean, over: Partial<TrendVersionData>) => ({
    trend_id: trendId, version, published_at: published ? "2026-10-20T10:00:00+00:00" : null, data: { ...DATA, source: SRC, ...over },
  })
  it("lists every version (published and draft) with a source, a preview offered and no clip, with its trend's slug and its whole data", async () => {
    db.respond = (q) => {
      if (q.table === "trends") return ok([{ id: T1, slug: "dance-off" }, { id: T2, slug: "jump" }])
      return ok([
        row(T1, 1, true, {}),
        row(T1, 2, false, { previewStart: 3 }),
        // What the database filters should already drop — filtered again here.
        row(T2, 1, false, { previewClip: { videoUrl: "x" } as never }),
        row(T2, 2, false, { previewStart: null }),
        row(T2, 3, false, { source: null }),
        row(T3, 1, false, {}),
      ])
    }
    const listed = await listVersionsLackingPreviewClip()
    expect(listed.map(({ data: _d, ...rest }) => rest)).toEqual([
      { trendId: T1, slug: "dance-off", version: 1, published: true },
      { trendId: T1, slug: "dance-off", version: 2, published: false },
      { trendId: T3, slug: null, version: 1, published: false },
    ])
    expect(listed[1]!.data.previewStart).toBe(3)
    const q = queries("trend_versions")[0]!
    expect(has(q, "not", "data->>source", "is", null)).toBe(true)
    expect(has(q, "not", "data->>previewStart", "is", null)).toBe(true)
    expect(has(q, "is", "data->>previewClip", null)).toBe(true)
    expect(argOf(q, "update")).toBeUndefined()
  })

  it("reads every page before returning", async () => {
    const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => row(T1, from + i + 1, false, {}))
    db.respond = (q) => {
      if (q.table === "trends") return ok([{ id: T1, slug: "dance-off" }])
      const [from] = argOf(q, "range") as [number, number]
      return ok(from === 0 ? page(0, 500) : page(500, 3))
    }
    expect(await listVersionsLackingPreviewClip()).toHaveLength(503)
    expect(queries("trend_versions")).toHaveLength(2)
  })
})

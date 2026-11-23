import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// `asset_favorites` / `catalog_favorites` until migration 688 reaches the
// database: absent until a probe has seen BOTH, forgotten again on a
// missing-table error. Staging runs dev against the shared database before the
// promotion applies the migration.
// ---------------------------------------------------------------------------

const db = vi.hoisted(() => ({
  answers: {} as Record<string, { error: null | { code?: string | null; message?: string } }>,
  tables: [] as string[],
  throws: false,
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        limit: async () => {
          db.tables.push(table)
          if (db.throws) throw new Error("unreachable")
          return db.answers[table] ?? { error: null }
        },
      }),
    }),
  },
}))

import {
  FAVORITES_TABLES,
  FAVORITES_TABLES_REPROBE_MS,
  favoritesTablesPresent,
  noteFavoritesTableError,
  probeFavoritesTables,
  setFavoritesTablesPresentForTests,
  watchFavoritesTables,
} from "../favorites-tables.js"

beforeEach(() => {
  db.answers = {}
  db.tables = []
  db.throws = false
  setFavoritesTablesPresentForTests(false)
})
afterEach(() => {
  setFavoritesTablesPresentForTests(false)
  vi.useRealTimers()
})

describe("the 688 favorites tables until they are in the database", () => {
  it("are absent until a probe has seen them", () => {
    expect(favoritesTablesPresent()).toBe(false)
  })

  it("one cheap read per table; present only when both answer", async () => {
    expect(await probeFavoritesTables()).toBe(true)
    expect([...db.tables].sort()).toEqual([...FAVORITES_TABLES].sort())
  })

  it("a missing table keeps them absent; any other failure changes nothing", async () => {
    db.answers.catalog_favorites = { error: { code: "PGRST205", message: "Could not find the table" } }
    expect(await probeFavoritesTables()).toBe(false)

    setFavoritesTablesPresentForTests(true)
    db.answers.catalog_favorites = { error: { code: "57P01", message: "terminating connection" } }
    expect(await probeFavoritesTables()).toBe(true)
    db.throws = true
    expect(await probeFavoritesTables()).toBe(true)
  })

  it("a missing-table error from any read forgets them until the next probe sees them", () => {
    setFavoritesTablesPresentForTests(true)
    expect(noteFavoritesTableError({ code: "42P01" })).toBe(true)
    expect(favoritesTablesPresent()).toBe(false)
    setFavoritesTablesPresentForTests(true)
    expect(noteFavoritesTableError({ code: "23505" })).toBe(false)
    expect(noteFavoritesTableError(null)).toBe(false)
    expect(favoritesTablesPresent()).toBe(true)
  })

  it("the watcher probes at boot and again until it sees them, then stops asking", async () => {
    vi.useFakeTimers()
    db.answers.asset_favorites = { error: { code: "42P01" } }
    watchFavoritesTables()
    await vi.advanceTimersByTimeAsync(0)
    expect(favoritesTablesPresent()).toBe(false)
    const asked = db.tables.length

    db.answers = {}
    await vi.advanceTimersByTimeAsync(FAVORITES_TABLES_REPROBE_MS)
    expect(favoritesTablesPresent()).toBe(true)
    expect(db.tables.length).toBeGreaterThan(asked)

    const after = db.tables.length
    await vi.advanceTimersByTimeAsync(FAVORITES_TABLES_REPROBE_MS * 2)
    expect(db.tables.length).toBe(after)
  })
})

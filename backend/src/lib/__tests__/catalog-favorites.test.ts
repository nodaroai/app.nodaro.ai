// @test-watches supabase/migrations/688_asset_and_catalog_favorites.sql
/**
 * Favorite picker options (lib/catalog-favorites.ts): the list is whole past
 * the API's row limit, and the per-person cap is the database's — the trigger
 * of migration 688, which a count-then-insert in the API could not make atomic
 * (its concurrency is proven against real Postgres by
 * backend/scripts/verify-catalog-favorites-cap-concurrency.mjs).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

type Row = { id: string; catalog: string; option_id: string; created_at: string }
const db = vi.hoisted(() => ({
  rows: [] as Row[],
  reads: [] as Array<{ after: string | null; limit: number }>,
  upsertError: null as null | { code: string; message: string },
  upserts: 0,
}))

vi.mock("@/lib/supabase.js", () => {
  function from() {
    let after: string | null = null
    let limit = Infinity
    let catalog: string | null = null
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, v: string) => {
        if (col === "catalog") catalog = v
        return builder
      },
      order: () => builder,
      limit: (n: number) => ((limit = n), builder),
      gt: (_c: string, v: string) => ((after = v), builder),
      upsert: async () => {
        db.upserts += 1
        return { error: db.upsertError }
      },
      maybeSingle: async () => ({ data: db.rows[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        db.reads.push({ after, limit })
        const rows = [...db.rows]
          .filter((r) => !catalog || r.catalog === catalog)
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .filter((r) => after === null || r.id > after)
          .slice(0, limit)
        return resolve({ data: rows, error: null })
      },
    }
    return builder
  }
  return { supabase: { from } }
})

import { CATALOG_FAVORITES_PAGE, MAX_CATALOG_FAVORITES_PER_USER, addCatalogFavorite, isCatalogCapError, listCatalogFavorites } from "../catalog-favorites.js"
import { setFavoritesTablesPresentForTests } from "../favorites-tables.js"

const ME = "00000000-0000-4000-8000-000000000001"
const rowId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
/** Ten rows share each second: the order's tie on `created_at` is broken by the id. */
const at = (n: number) => `2026-11-01T10:${String(Math.floor(n / 600)).padStart(2, "0")}:${String(Math.floor(n / 10) % 60).padStart(2, "0")}+00:00`

beforeEach(() => {
  setFavoritesTablesPresentForTests(true)
  db.rows = []
  db.reads = []
  db.upsertError = null
  db.upserts = 0
})

describe("listCatalogFavorites", () => {
  it("reads past the API's row limit in pages by id, and answers every row newest first", async () => {
    const total = CATALOG_FAVORITES_PAGE * 2 + 37
    db.rows = Array.from({ length: total }, (_, n) => ({ id: rowId(n + 1), catalog: "style", option_id: `o-${n}`, created_at: at(n) }))
    const list = await listCatalogFavorites(ME)
    expect(list).toHaveLength(total)
    expect(db.reads).toEqual([
      { after: null, limit: CATALOG_FAVORITES_PAGE },
      { after: rowId(CATALOG_FAVORITES_PAGE), limit: CATALOG_FAVORITES_PAGE },
      { after: rowId(CATALOG_FAVORITES_PAGE * 2), limit: CATALOG_FAVORITES_PAGE },
    ])
    // Newest first, the id breaking a tie.
    expect(list[0]!.optionId).toBe(`o-${total - 1}`)
    expect(list[list.length - 1]!.optionId).toBe("o-0")
    for (let i = 1; i < list.length; i++) expect(list[i - 1]!.createdAt >= list[i]!.createdAt).toBe(true)
  })

  it("a list that fits one page is one read", async () => {
    db.rows = [{ id: rowId(1), catalog: "style", option_id: "watercolor", created_at: at(1) }]
    expect(await listCatalogFavorites(ME)).toHaveLength(1)
    expect(db.reads).toHaveLength(1)
  })

  it("is empty, with no read, before migration 688", async () => {
    setFavoritesTablesPresentForTests(false)
    expect(await listCatalogFavorites(ME)).toEqual([])
    expect(db.reads).toEqual([])
  })
})

describe("addCatalogFavorite: the cap is the database's", () => {
  const key = { catalog: "style", optionId: "watercolor", label: "Watercolor" }

  it("writes without a count read first (the count could not be atomic)", async () => {
    expect((await addCatalogFavorite(ME, key)).kind).toBe("ok")
    expect(db.upserts).toBe(1)
    expect(db.reads).toEqual([])
  })

  it("the trigger's refusal is limit_reached", async () => {
    db.upsertError = { code: "23514", message: "catalog_favorites_per_user_cap" }
    expect(await addCatalogFavorite(ME, key)).toEqual({ kind: "limit_reached" })
  })

  it("another check_violation (a length) is not the cap: it throws", async () => {
    db.upsertError = { code: "23514", message: 'new row for relation "catalog_favorites" violates check constraint' }
    await expect(addCatalogFavorite(ME, key)).rejects.toMatchObject({ code: "23514" })
    expect(isCatalogCapError(db.upsertError)).toBe(false)
  })

  it("the number in the code is the number the migration's trigger holds", () => {
    const sql = readFileSync(join(__dirname, "../../../../supabase/migrations/688_asset_and_catalog_favorites.sql"), "utf8")
    const trigger = sql.slice(sql.indexOf("FUNCTION public.catalog_favorites_enforce_cap"))
    expect(trigger).toMatch(new RegExp(`count\\(\\*\\) FROM public\\.catalog_favorites c WHERE c\\.user_id = NEW\\.user_id\\) >= ${MAX_CATALOG_FAVORITES_PER_USER}\\b`))
    expect(trigger).toContain("'catalog_favorites_per_user_cap'")
  })
})

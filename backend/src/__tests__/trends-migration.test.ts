// @test-watches supabase/migrations/549_trends.sql
/**
 * Guards on migration 549: the trend catalog's three tables — trends (one row
 * per trend, its status and draft/published version numbers), trend_versions
 * (each version's JSON snapshot) and trend_favorites (a user's saved trends).
 * Reached only through the API, which scopes every query: RLS on, no client
 * grants, no policy (the 518 posture).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const REPO_ROOT = join(__dirname, "..", "..", "..")
const sql = readFileSync(join(REPO_ROOT, "supabase", "migrations", "549_trends.sql"), "utf8")
/** The SQL without its `--` comments, so prose in the header never satisfies a guard. */
const code = sql.replace(/--[^\n]*/g, "")
const TABLES = ["trends", "trend_versions", "trend_favorites"] as const

describe("migration 549 — trends", () => {
  it("creates the three tables idempotently", () => {
    for (const table of TABLES) {
      expect(code).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\(`))
    }
  })

  it("trends: uuid id, a unique slug shaped like a path segment that can never be 'runs'", () => {
    expect(code).toMatch(/id\s+UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/)
    expect(code).toMatch(
      /slug\s+TEXT NOT NULL UNIQUE CHECK \(slug ~ '\^\[a-z0-9\]\[a-z0-9-\]\{0,63\}\$' AND slug <> 'runs'\)/,
    )
  })

  it("trends: status is draft | published | unpublished, draft by default", () => {
    expect(code).toMatch(
      /status\s+TEXT NOT NULL DEFAULT 'draft' CHECK \(status IN \('draft', 'published', 'unpublished'\)\)/,
    )
  })

  it("trends: tags free, badges only 'trending' / 'new'", () => {
    expect(code).toMatch(/tags\s+TEXT\[\] NOT NULL DEFAULT '\{\}'/)
    expect(code).toMatch(
      /badges\s+TEXT\[\] NOT NULL DEFAULT '\{\}' CHECK \(badges <@ ARRAY\['trending', 'new'\]::TEXT\[\]\)/,
    )
  })

  it("trends: order, draft/published version numbers, author and timestamps", () => {
    expect(code).toMatch(/sort_order\s+INT NOT NULL DEFAULT 0/)
    expect(code).toMatch(/draft_version\s+INT NOT NULL DEFAULT 1/)
    expect(code).toMatch(/published_version\s+INT,/)
    expect(code).toMatch(/created_by\s+UUID REFERENCES public\.profiles\(id\) ON DELETE SET NULL/)
    expect(code).toMatch(/created_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/)
    expect(code).toMatch(/updated_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/)
  })

  it("trends: the catalog's keyset index (status, sort_order, id)", () => {
    expect(code).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_trends_status_sort\s+ON public\.trends \(status, sort_order, id\)/,
    )
  })

  it("trend_versions: one JSON snapshot per (trend, version), gone with its trend", () => {
    expect(code).toMatch(/trend_id\s+UUID NOT NULL REFERENCES public\.trends\(id\) ON DELETE CASCADE,\s+version\s+INT NOT NULL/)
    expect(code).toMatch(/data\s+JSONB NOT NULL/)
    // The draft's optimistic-concurrency token: a new value on every write.
    expect(code).toMatch(/revision\s+UUID NOT NULL DEFAULT gen_random_uuid\(\)/)
    expect(code).toMatch(/published_at\s+TIMESTAMPTZ/)
    expect(code).toMatch(/PRIMARY KEY \(trend_id, version\)/)
  })

  it("trend_favorites: one row per (user, trend), gone with either, listed newest first", () => {
    expect(code).toMatch(/user_id\s+UUID NOT NULL REFERENCES public\.profiles\(id\) ON DELETE CASCADE/)
    expect(code).toMatch(/trend_id\s+UUID NOT NULL REFERENCES public\.trends\(id\) ON DELETE CASCADE,\s+created_at/)
    expect(code).toMatch(/PRIMARY KEY \(user_id, trend_id\)/)
    expect(code).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_trend_favorites_user_created\s+ON public\.trend_favorites \(user_id, created_at DESC\)/,
    )
  })

  it("RLS on all three, revoked from every client role, service role only, no policy", () => {
    for (const table of TABLES) {
      expect(code).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`))
      expect(code).toMatch(new RegExp(`REVOKE ALL ON public\\.${table} FROM PUBLIC, anon, authenticated`))
      expect(code).toMatch(new RegExp(`GRANT ALL ON public\\.${table} TO service_role`))
    }
    expect(code).not.toMatch(/CREATE POLICY/)
    expect(code).not.toMatch(/GRANT [^;]* TO (anon|authenticated|PUBLIC)/)
  })

  it("the header says why: API-only, RLS on, no client grants", () => {
    expect(sql).toMatch(/RLS on, no client grants/)
  })
})

// @test-watches supabase/migrations/555_trend_tags.sql
/**
 * Guards on migration 555: trend tag labels. A trend's tags stay plain strings
 * on `trends.tags`; `trend_tags` holds each tag's label per platform language
 * (keyed by the exact tag string; a tag with no row reads as itself). Reached
 * only through the API: RLS on, no client grants, no policy (549's posture).
 * And `tags` joins `runs` as a slug no trend may take: `/v1/trends/tags` is
 * the tag list.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const REPO_ROOT = join(__dirname, "..", "..", "..")
const sql = readFileSync(join(REPO_ROOT, "supabase", "migrations", "555_trend_tags.sql"), "utf8")
/** The SQL without its `--` comments, so prose in the header never satisfies a guard. */
const code = sql.replace(/--[^\n]*/g, "")

describe("migration 555 — trend tag labels", () => {
  it("creates trend_tags idempotently, keyed by the tag as trends store it (1–100 characters)", () => {
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.trend_tags \(/)
    expect(code).toMatch(/tag\s+TEXT PRIMARY KEY CHECK \(char_length\(tag\) BETWEEN 1 AND 100\)/)
  })

  it("labels are a JSON object (locale → text), empty by default", () => {
    expect(code).toMatch(/labels\s+JSONB NOT NULL DEFAULT '\{\}'::jsonb CHECK \(jsonb_typeof\(labels\) = 'object'\)/)
    expect(code).toMatch(/created_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/)
    expect(code).toMatch(/updated_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/)
  })

  it("RLS on, revoked from every client role, service role only, no policy", () => {
    expect(code).toMatch(/ALTER TABLE public\.trend_tags ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/REVOKE ALL ON public\.trend_tags FROM PUBLIC, anon, authenticated/)
    expect(code).toMatch(/GRANT ALL ON public\.trend_tags TO service_role/)
    expect(code).not.toMatch(/CREATE POLICY/)
    expect(code).not.toMatch(/GRANT [^;]* TO (anon|authenticated|PUBLIC)/)
  })

  it("reserves the slug 'tags' without failing on a row that already has it (NOT VALID), idempotently", () => {
    expect(code).toMatch(/ALTER TABLE public\.trends DROP CONSTRAINT IF EXISTS trends_slug_not_tags/)
    expect(code).toMatch(/ALTER TABLE public\.trends\s+ADD CONSTRAINT trends_slug_not_tags CHECK \(slug <> 'tags'\) NOT VALID/)
  })

  it("the header says why: API-only, RLS on, no client grants", () => {
    expect(sql).toMatch(/RLS on, no client grants/)
  })
})

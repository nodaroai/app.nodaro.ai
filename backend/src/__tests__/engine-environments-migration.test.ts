// @test-watches supabase/migrations/548_engine_environments.sql
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Migration 548 (Trends, spec D17): `engine_environments`, one row per
 * environment (staging, production — they share one database) recording what
 * its pinned Cast Swap plugin supports, so publishing a trend can check every
 * environment's engine. Written by the API server at boot with the service
 * role; read only by the API (`ee/lib/engine-environments.ts`).
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(HERE, "../../../supabase/migrations/548_engine_environments.sql"), "utf8")
/** The statements, comments removed. */
const code = sql.replace(/--.*$/gm, "")

describe("migration 548 — engine environments", () => {
  it("creates the table idempotently, keyed by the environment name", () => {
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.engine_environments \(/i)
    expect(code).toMatch(/env\s+TEXT PRIMARY KEY CHECK \(env ~ '\^\[a-z0-9-\]\{1,40\}\$'\)/i)
    expect(code).toMatch(/plugin_build_id\s+TEXT,/i)
    expect(code).toMatch(/supports\s+JSONB NOT NULL DEFAULT '\{\}'/i)
    expect(code).toMatch(/updated_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/i)
  })

  it("is reachable only through the API: RLS on, no client grants, no policy (the 518 posture)", () => {
    expect(code).toMatch(/ALTER TABLE public\.engine_environments ENABLE ROW LEVEL SECURITY;/)
    expect(code).toMatch(/REVOKE ALL ON public\.engine_environments FROM PUBLIC, anon, authenticated;/)
    expect(code).toMatch(/GRANT ALL ON public\.engine_environments TO service_role;/)
    expect(code).not.toMatch(/CREATE POLICY/i)
  })
})

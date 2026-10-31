// @test-watches supabase/migrations/*_lane_usage_daily.sql supabase/tests/lane-usage-history.behavior.sql
/**
 * The lane history migration: the daily rows per (environment, user, payer)
 * and per (environment, provider), and the sampled-minutes row per
 * (environment, day). The behaviour proof
 * (`supabase/tests/lane-usage-history.behavior.sql`) runs it on a real
 * Postgres in CI (RLS, grants, defaults, the cascade). This file holds the SQL
 * shape the writer relies on: the columns it upserts, the conflict keys it
 * names, every statement safe to re-run, and service-role only.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { HISTORY_CONFLICT_KEYS, HISTORY_TABLES } from "../history.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(HERE, "../../../../../supabase/migrations")
const PROOF = join(HERE, "../../../../../supabase/tests/lane-usage-history.behavior.sql")

function historyMigration(): { file: string; code: string } {
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d{3}_lane_usage_daily\.sql$/.test(f))
  expect(files, "exactly one NNN_lane_usage_daily.sql").toHaveLength(1)
  const file = files[0]!
  // Statements only: comments removed, so prose can never satisfy a check.
  return { file, code: readFileSync(join(MIGRATIONS, file), "utf8").replace(/--.*$/gm, "") }
}

const TABLES = ["lane_usage_daily", "lane_provider_daily", "lane_history_days"] as const

/** The body of `CREATE TABLE IF NOT EXISTS public.<name> ( … );`. */
function tableBody(code: string, name: string): string {
  const m = new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${name} \\(([\\s\\S]*?)\\n\\);`).exec(code)
  expect(m, `CREATE TABLE IF NOT EXISTS public.${name}`).not.toBeNull()
  return m![1]!
}

/** The column definitions of a table body, name → rest of the line (no trailing comma). */
function columns(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of body.split("\n").map((l) => l.trim().replace(/,$/, "")).filter(Boolean)) {
    if (line.startsWith("PRIMARY KEY")) continue
    const [name, ...rest] = line.split(" ")
    out[name!] = rest.join(" ")
  }
  return out
}

describe("lane history migration", () => {
  it("the writer's tables are exactly the migration's", () => {
    expect([...HISTORY_TABLES].sort()).toEqual([...TABLES].sort())
  })

  it("lane_usage_daily has the history columns, keyed by (day, runtime_env, user_id, payer), cascading with the profile", () => {
    const body = tableBody(historyMigration().code, "lane_usage_daily")
    expect(columns(body)).toEqual({
      day: "DATE NOT NULL",
      runtime_env: "TEXT NOT NULL",
      user_id: "UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE",
      payer: "TEXT NOT NULL",
      peak_running: "JSONB NOT NULL DEFAULT '{}'::jsonb",
      peak_queued: "JSONB NOT NULL DEFAULT '{}'::jsonb",
      peak_over_limit: "JSONB NOT NULL DEFAULT '{}'::jsonb",
      longest_wait_ms: "BIGINT NOT NULL DEFAULT 0",
      minutes_at_limit: "INT NOT NULL DEFAULT 0",
      queue_timeouts: "INT NOT NULL DEFAULT 0",
      live_wait_expiries: "INT NOT NULL DEFAULT 0",
      peak_by_source: "JSONB NOT NULL DEFAULT '{}'::jsonb",
      updated_at: "TIMESTAMPTZ NOT NULL DEFAULT now()",
    })
    expect(body).toMatch(/PRIMARY KEY \(day, runtime_env, user_id, payer\)/)
    expect(HISTORY_CONFLICT_KEYS.lane_usage_daily).toBe("day,runtime_env,user_id,payer")
  })

  it("lane_provider_daily has the provider columns, keyed by (day, runtime_env, provider); ceiling may be NULL", () => {
    const body = tableBody(historyMigration().code, "lane_provider_daily")
    expect(columns(body)).toEqual({
      day: "DATE NOT NULL",
      runtime_env: "TEXT NOT NULL",
      provider: "TEXT NOT NULL",
      peak_running: "INT NOT NULL DEFAULT 0",
      ceiling: "INT NULL",
      completed: "INT NOT NULL DEFAULT 0",
      failed: "INT NOT NULL DEFAULT 0",
      minutes_at_ceiling: "INT NOT NULL DEFAULT 0",
      updated_at: "TIMESTAMPTZ NOT NULL DEFAULT now()",
    })
    expect(body).toMatch(/PRIMARY KEY \(day, runtime_env, provider\)/)
    expect(HISTORY_CONFLICT_KEYS.lane_provider_daily).toBe("day,runtime_env,provider")
  })

  it("lane_history_days counts sampled and enforced minutes, keyed by (day, runtime_env)", () => {
    const body = tableBody(historyMigration().code, "lane_history_days")
    expect(columns(body)).toEqual({
      day: "DATE NOT NULL",
      runtime_env: "TEXT NOT NULL",
      sampled_minutes: "INT NOT NULL DEFAULT 0",
      enforced_minutes: "INT NOT NULL DEFAULT 0",
      updated_at: "TIMESTAMPTZ NOT NULL DEFAULT now()",
    })
    expect(body).toMatch(/PRIMARY KEY \(day, runtime_env\)/)
    expect(HISTORY_CONFLICT_KEYS.lane_history_days).toBe("day,runtime_env")
  })

  it("every table is service-role only: RLS on, a guarded service_role policy and no grant to a client role", () => {
    const { code } = historyMigration()
    for (const t of TABLES) {
      expect(code, t).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY;`))
      expect(code, t).toMatch(new RegExp(`tablename = '${t}' AND policyname = 'service_role_all'`))
      expect(code, t).toMatch(new RegExp(`CREATE POLICY "service_role_all" ON public\\.${t} FOR ALL TO service_role USING \\(true\\) WITH CHECK \\(true\\);`))
      for (const role of ["PUBLIC", "anon", "authenticated"]) {
        expect(code, `${t} ${role}`).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${t} FROM ${role};`))
      }
      expect(code, t).toMatch(new RegExp(`GRANT ALL ON TABLE public\\.${t} TO service_role;`))
    }
    expect(code).not.toMatch(/^\s*GRANT\s[^;]*\bTO\s+(anon|authenticated|PUBLIC)\b/im)
  })

  it("bounds its lock wait first and is safe to re-run (CI re-applies the newest migration)", () => {
    const { code } = historyMigration()
    expect(code.trimStart().startsWith("SET LOCAL lock_timeout = '2s';")).toBe(true)
    expect(code).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/)
    expect(code).not.toMatch(/CREATE INDEX (?!IF NOT EXISTS)/)
    expect(code).not.toMatch(/ALTER TABLE public\.(jobs|workflow_executions|pipelines|profiles)\b/)
    const policies = code.match(/CREATE POLICY/g) ?? []
    const guarded = code.match(/IF NOT EXISTS \(SELECT 1 FROM pg_policies/g) ?? []
    expect(policies.length).toBe(TABLES.length)
    expect(guarded.length).toBe(policies.length)
  })

  it("indexes one user's days (the drill-down and the profile cascade)", () => {
    expect(historyMigration().code).toMatch(/CREATE INDEX IF NOT EXISTS idx_lane_usage_daily_user ON public\.lane_usage_daily \(user_id, day\);/)
  })

  it("has a real-Postgres behaviour proof that reaches its final assertion", () => {
    const proof = readFileSync(PROOF, "utf8")
    for (const t of TABLES) expect(proof, t).toContain(`public.${t}`)
    expect(proof).toContain("ALL BEHAVIOR ASSERTIONS PASSED")
    expect(proof).toMatch(/ROLLBACK;\s*$/)
  })
})

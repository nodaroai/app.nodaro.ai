// @test-watches supabase/migrations/*_concurrency_lanes.sql supabase/migrations/*_jobs_lane_queued_index.sql supabase/tests/concurrency-lanes.behavior.sql
/**
 * The concurrency-lanes migration: the per-plan size table, per-user
 * overrides, platform provider ceilings, the requeue side table, the three
 * settings and the queue stamps on jobs / workflow_executions / pipelines.
 *
 * The behaviour proof (`supabase/tests/concurrency-lanes.behavior.sql`) runs
 * the migration on a real Postgres in CI (RLS, grants, defaults, the index,
 * the cascade). This file holds what only TypeScript can: the seeded sizes
 * equal the code default (`defaultLaneSizesForTier`) for every tier, and the
 * SQL keeps the shape the readers rely on (every statement safe to re-run,
 * the lock bound ahead of the jobs statements, the queued-jobs index alone in
 * its own migration so its heap scan never runs under 568's ACCESS EXCLUSIVE).
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { LANE_PLAN_TIERS, defaultLaneSizesForTier } from "../../../lib/concurrency-lanes/defaults.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(HERE, "../../../../../supabase/migrations")
const PROOF = join(HERE, "../../../../../supabase/tests/concurrency-lanes.behavior.sql")

function laneMigration(): { file: string; code: string } {
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d{3}_concurrency_lanes\.sql$/.test(f))
  expect(files, "exactly one NNN_concurrency_lanes.sql").toHaveLength(1)
  const file = files[0]!
  // Statements only: comments removed, so prose can never satisfy a check.
  const code = readFileSync(join(MIGRATIONS, file), "utf8").replace(/--.*$/gm, "")
  return { file, code }
}

function indexMigration(): { file: string; code: string } {
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d{3}_jobs_lane_queued_index\.sql$/.test(f))
  expect(files, "exactly one NNN_jobs_lane_queued_index.sql").toHaveLength(1)
  const file = files[0]!
  return { file, code: readFileSync(join(MIGRATIONS, file), "utf8").replace(/--.*$/gm, "") }
}

const LANE_TABLES = ["lane_plan_sizes", "lane_user_overrides", "lane_provider_ceilings", "lane_requeue_payloads"] as const
const LANES = ["provider", "llm", "local", "run"] as const

/** The body of `CREATE TABLE IF NOT EXISTS public.<name> ( … );`. */
function tableBody(code: string, name: string): string {
  const m = new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${name} \\(([\\s\\S]*?)\\n\\);`).exec(code)
  expect(m, `CREATE TABLE IF NOT EXISTS public.${name}`).not.toBeNull()
  return m![1]!
}

describe("concurrency-lanes migration", () => {
  it("the four tables are created idempotently with RLS on", () => {
    const { code } = laneMigration()
    for (const t of LANE_TABLES) {
      tableBody(code, t)
      expect(code, t).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY;`))
    }
  })

  it("every table is service-role only: a guarded service_role policy and no grant to a client role", () => {
    const { code } = laneMigration()
    for (const t of LANE_TABLES) {
      expect(code, t).toMatch(new RegExp(`tablename = '${t}' AND policyname = 'service_role_all'`))
      expect(code, t).toMatch(new RegExp(`CREATE POLICY "service_role_all" ON public\\.${t} FOR ALL TO service_role USING \\(true\\) WITH CHECK \\(true\\);`))
      for (const role of ["PUBLIC", "anon", "authenticated"]) {
        expect(code, `${t} ${role}`).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${t} FROM ${role};`))
      }
      expect(code, t).toMatch(new RegExp(`GRANT ALL ON TABLE public\\.${t} TO service_role;`))
    }
    // A GRANT statement (not the word inside a COMMENT ON string) to a client role.
    expect(code).not.toMatch(/^\s*GRANT\s[^;]*\bTO\s+(anon|authenticated|PUBLIC)\b/im)
  })

  it("lane_requeue_payloads is keyed by (kind, row_id) and kind is one of job / execution / pipeline", () => {
    const body = tableBody(laneMigration().code, "lane_requeue_payloads")
    expect(body).toMatch(/kind TEXT NOT NULL CHECK \(kind IN \('job', 'execution', 'pipeline'\)\)/)
    for (const col of ["row_id UUID NOT NULL", "bull_queue TEXT NOT NULL", "bull_job_id TEXT NOT NULL", "name TEXT NOT NULL", "data JSONB NOT NULL", "opts JSONB NOT NULL", "created_at TIMESTAMPTZ NOT NULL DEFAULT now()"]) {
      expect(body, col).toContain(col)
    }
    expect(body).toMatch(/PRIMARY KEY \(kind, row_id\)/)
  })

  it("plan sizes are bounded 1–500, overrides are nullable but bounded 1–500 and cascade with the profile, ceilings are ≥ 1", () => {
    const { code } = laneMigration()
    const plans = tableBody(code, "lane_plan_sizes")
    expect(plans).toMatch(/tier TEXT PRIMARY KEY/)
    for (const lane of LANES) expect(plans, lane).toMatch(new RegExp(`\\b${lane} INT NOT NULL CHECK \\(${lane} BETWEEN 1 AND 500\\)`))
    const overrides = tableBody(code, "lane_user_overrides")
    expect(overrides).toMatch(/user_id UUID PRIMARY KEY REFERENCES public\.profiles\(id\) ON DELETE CASCADE/)
    for (const lane of LANES) expect(overrides, lane).toMatch(new RegExp(`\\b${lane} INT NULL CHECK \\(${lane} BETWEEN 1 AND 500\\)`))
    expect(overrides).toMatch(/updated_by UUID REFERENCES public\.profiles\(id\) ON DELETE SET NULL/)
    const ceilings = tableBody(code, "lane_provider_ceilings")
    expect(ceilings).toMatch(/provider TEXT PRIMARY KEY/)
    expect(ceilings).toMatch(/ceiling INT NOT NULL CHECK \(ceiling >= 1\)/)
  })

  it("seeds one row per lane plan tier equal to defaultLaneSizesForTier, and nothing else", () => {
    const { code } = laneMigration()
    const insert = /INSERT INTO public\.lane_plan_sizes \(tier, provider, llm, local, run\) VALUES([\s\S]*?)ON CONFLICT \(tier\) DO NOTHING;/.exec(code)
    expect(insert, "the seed INSERT … ON CONFLICT (tier) DO NOTHING").not.toBeNull()
    const rows = [...insert![1]!.matchAll(/\('([a-z]+)', (\d+), (\d+), (\d+), (\d+)\)/g)].map((m) => ({
      tier: m[1]!,
      sizes: { provider: Number(m[2]), llm: Number(m[3]), local: Number(m[4]), run: Number(m[5]) },
    }))
    expect(rows.map((r) => r.tier).sort()).toEqual([...LANE_PLAN_TIERS].sort())
    for (const { tier, sizes } of rows) expect(sizes, tier).toEqual(defaultLaneSizesForTier(tier))
    // The spec's worked value: a free plan runs 4 LLM calls at once.
    expect(rows.find((r) => r.tier === "free")!.sizes.llm).toBe(4)
    // Enterprise defaults to Business's sizes.
    expect(rows.find((r) => r.tier === "enterprise")!.sizes).toEqual(rows.find((r) => r.tier === "business")!.sizes)
  })

  it("adds the three settings without overwriting an edited value", () => {
    const { code } = laneMigration()
    const insert = /INSERT INTO public\.app_settings \(key, value\) VALUES([\s\S]*?)ON CONFLICT \(key\) DO NOTHING;/.exec(code)
    expect(insert).not.toBeNull()
    const values = Object.fromEntries([...insert![1]!.matchAll(/\('([a-z_]+)', '([^']*)'::jsonb\)/g)].map((m) => [m[1]!, JSON.parse(m[2]!)]))
    expect(values).toEqual({ lane_queue_timeout_minutes: 120, lane_live_wait_minutes: 10, lanes_enforced: {} })
  })

  it("stamps jobs, workflow_executions and pipelines with the queue columns and their defaults", () => {
    const { code } = laneMigration()
    const common = ["lane_queued_at TIMESTAMPTZ", "lane_env TEXT", "lane_env_id TEXT", "lane_wait_ms BIGINT NOT NULL DEFAULT 0"]
    const expected: Record<string, string[]> = {
      jobs: [...common, "lane_bull_queue TEXT", "lane_bull_job_id TEXT"],
      workflow_executions: common,
      pipelines: common,
    }
    for (const [table, cols] of Object.entries(expected)) {
      for (const col of cols) {
        expect(code, `${table}.${col}`).toMatch(new RegExp(`ALTER TABLE public\\.${table} ADD COLUMN IF NOT EXISTS ${col.replace(/[()]/g, "\\$&")};`))
      }
    }
    // Nothing else named lane_* lands on those tables.
    const added = [...code.matchAll(/ALTER TABLE public\.(jobs|workflow_executions|pipelines) ADD COLUMN IF NOT EXISTS (lane_\w+)/g)].map((m) => `${m[1]}.${m[2]}`)
    expect(added.sort()).toEqual(Object.entries(expected).flatMap(([t, cols]) => cols.map((c) => `${t}.${c.split(" ")[0]}`)).sort())
  })

  it("568 bounds every lock wait ahead of the jobs statements and builds no index", () => {
    const { code } = laneMigration()
    const lock = code.indexOf("SET LOCAL lock_timeout = '2s';")
    expect(lock).toBeGreaterThanOrEqual(0)
    expect(lock).toBeLessThan(code.indexOf("ALTER TABLE public.jobs"))
    expect(code).not.toMatch(/CREATE INDEX/)
  })

  it("the queued-jobs index is alone in a later migration: lock bound, then the partial index, nothing else", () => {
    const lanes = laneMigration()
    const { file, code } = indexMigration()
    expect(Number(file.slice(0, 3))).toBeGreaterThan(Number(lanes.file.slice(0, 3)))
    const statements = code.split(";").map((st) => st.trim().replace(/\s+/g, " ")).filter(Boolean)
    expect(statements).toEqual([
      "SET LOCAL lock_timeout = '2s'",
      "CREATE INDEX IF NOT EXISTS idx_jobs_lane_queued ON public.jobs (lane_env, lane_queued_at) WHERE status = 'queued'",
    ])
  })

  it("every statement is safe to re-run (CI re-applies the newest migration)", () => {
    const { code } = laneMigration()
    expect(code).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/)
    expect(code).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/)
    expect(code).not.toMatch(/CREATE INDEX (?!IF NOT EXISTS)/)
    const policies = code.match(/CREATE POLICY/g) ?? []
    const guarded = code.match(/IF NOT EXISTS \(SELECT 1 FROM pg_policies/g) ?? []
    expect(policies.length).toBe(LANE_TABLES.length)
    expect(guarded.length).toBe(policies.length)
    for (const insert of code.match(/INSERT INTO[\s\S]*?;/g) ?? []) expect(insert).toMatch(/ON CONFLICT \([a-z_]+\) DO NOTHING;$/)
  })

  it("has a real-Postgres behaviour proof that reaches its final assertion", () => {
    const proof = readFileSync(PROOF, "utf8")
    for (const t of LANE_TABLES) expect(proof, t).toContain(`public.${t}`)
    expect(proof).toContain("ALL BEHAVIOR ASSERTIONS PASSED")
    expect(proof).toMatch(/ROLLBACK;\s*$/)
  })
})

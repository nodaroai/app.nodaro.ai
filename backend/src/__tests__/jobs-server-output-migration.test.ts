// @test-watches supabase/migrations/*.sql
/**
 * `jobs.server_output` (migration 695, decided 2026-11-24): a server-only
 * bookkeeping field of what a job stored. Pinned here, on the SQL itself:
 *  1. no migration grants `server_output` to a client role; 695 revokes it,
 *     and its record function is closed to browser roles and runs as its caller;
 *  2. the record function treats exactly the repo's in-flight statuses as live;
 *  3. each of the cleanup's two lookups is closed to browser roles and states
 *     its partial index's condition exactly, ordered by id with a bounded page.
 * Its behaviour against real Postgres is `supabase/tests/job-stored-objects.behavior.sql`.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { IN_FLIGHT_JOB_STATUSES } from "../lib/job-status.js"

const MIGRATIONS = join(__dirname, "..", "..", "..", "supabase", "migrations")
const m695 = (): string => readFileSync(join(MIGRATIONS, "695_jobs_server_output.sql"), "utf8")

describe("jobs.server_output stays server-only", () => {
  it("no migration grants server_output to a client role; 695 revokes it and closes its function", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))
    const grants = files.flatMap((f) =>
      [...readFileSync(join(MIGRATIONS, f), "utf8").matchAll(/GRANT\s+SELECT\s*\(([^)]*)\)\s+ON\s+(?:TABLE\s+)?public\.jobs\s+TO\s+([^;]+);/gi)]
        .filter((m) => /\bserver_output\b/.test(m[1]!))
        .map((m) => `${f}: ${m[0]}`),
    )
    expect(grants).toEqual([])
    expect(m695()).toMatch(/REVOKE SELECT \(server_output\) ON public\.jobs FROM PUBLIC, anon, authenticated;/)
    expect(m695()).toMatch(/REVOKE EXECUTE ON FUNCTION public\.record_job_stored_object\(uuid, text, bigint, boolean, jsonb, timestamptz\) FROM PUBLIC, anon, authenticated;/)
    expect(m695()).not.toMatch(/SECURITY DEFINER/)
  })
})

describe("the record function's live statuses are the repo's in-flight set", () => {
  it("record_job_stored_object treats exactly IN_FLIGHT_JOB_STATUSES as live (a queued job included)", () => {
    const fn = m695().slice(m695().indexOf("FUNCTION public.record_job_stored_object"))
    const listed = /job_status NOT IN \(([^)]*)\)/.exec(fn)?.[1]?.split(",").map((v) => v.trim().replace(/'/g, ""))
    expect(new Set(listed)).toEqual(new Set(IN_FLIGHT_JOB_STATUSES))
  })
})

describe("the periodic cleanup's two lookups", () => {
  const LOOKUPS = [
    { fn: "ended_jobs_with_stored_objects", index: "696_jobs_server_output_ended_index.sql" },
    { fn: "completed_jobs_left_unpruned", index: "697_jobs_completed_unpruned_index.sql" },
  ] as const
  const normalize = (sql: string): string => sql.replace(/\bj\./g, "").replace(/\s+/g, " ").trim()

  it.each(LOOKUPS)("$fn is closed to browser roles, granted to the service role, and runs as its caller", ({ fn }) => {
    expect(m695()).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn}(uuid, integer) FROM PUBLIC, anon, authenticated;`)
    expect(m695()).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}(uuid, integer) TO service_role;`)
  })

  it.each(LOOKUPS)("$fn states its index's condition exactly, ordered by id, at most 1000 rows a page", ({ fn, index }) => {
    const body = m695().slice(m695().indexOf(`FUNCTION public.${fn}(`))
    const sql = normalize(body.slice(0, body.indexOf("$$;", body.indexOf("$$") + 2)))
    const indexSql = readFileSync(join(MIGRATIONS, index), "utf8")
    const predicate = normalize(/WHERE ([^;]+);/.exec(indexSql.slice(indexSql.indexOf("CREATE INDEX IF NOT EXISTS")))![1]!)
    expect(sql).toContain(predicate.replace(/^/, "WHERE "))
    expect(sql).toContain("ORDER BY id LIMIT least(greatest(coalesce(p_limit, 0), 0), 1000)")
  })
})

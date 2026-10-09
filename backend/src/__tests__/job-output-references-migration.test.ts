import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Migration 495 (decided 2026-10-08): the index and functions the retention
 * reapers ask "which job outputs name this url" through
 * (`lib/job-output-references.ts`).
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(HERE, "../../../supabase/migrations/495_job_output_url_references.sql"), "utf8")
const caller = readFileSync(join(HERE, "../lib/job-output-references.ts"), "utf8")
/** The statements, comments removed. */
const code = sql.replace(/--.*$/gm, "")

describe("migration 495 — job output url references", () => {
  it("defines every function the backend calls", () => {
    const called = [...new Set([...caller.matchAll(/supabase\.rpc\("([a-z_]+)"/g)].map((m) => m[1]))]
    expect(called.sort()).toEqual(["blank_job_output_urls", "mark_job_outputs_cleaned", "urls_linked_by_jobs_since"])
    for (const fn of called) expect(code).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`))
  })

  it("no longer defines the raw-copy hold-back lookup (dropped, decided 2026-10-08 round 12)", () => {
    expect(code).not.toMatch(/job_output_urls_still_referenced/)
  })

  it("the functions that read or write rows are the backend's only", () => {
    for (const sig of [
      "blank_job_output_urls(text[], integer)",
      "jsonb_with_strings_nulled(jsonb, text[])",
      "mark_job_outputs_cleaned(uuid[], text[])",
      "urls_linked_by_jobs_since(text[], timestamptz[])",
    ]) {
      const esc = sig.replace(/[()[\]]/g, (c) => `\\${c}`)
      expect(code).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${esc} FROM PUBLIC, anon, authenticated;`))
      expect(code).toMatch(new RegExp(`GRANT\\s+EXECUTE ON FUNCTION public\\.${esc} TO service_role;`))
    }
  })

  it("marks a batch cleaned from each row's CURRENT output, never a whole output read earlier", () => {
    const fn = code.match(/FUNCTION public\.mark_job_outputs_cleaned\([\s\S]*?\$\$;/)
    expect(fn).not.toBeNull()
    // The update reads j.output_data (the row's value at write time) and adds the marker.
    expect(fn![0]).toMatch(/jsonb_with_strings_nulled\(j\.output_data, coalesce\(p_urls/)
    expect(fn![0]).toMatch(/\|\| '\{"_cleaned": true\}'::jsonb/)
    expect(fn![0]).toMatch(/WHERE j\.id = ANY \(p_ids\)/)
    // Every selected output is marked — a non-object one too — or the reaper
    // would select it again every run.
    expect(fn![0]).toMatch(/ELSE jsonb_build_object\('_cleaned', true, 'output',/)
    expect(fn![0]).not.toMatch(/jsonb_typeof\(j\.output_data\) = 'object'\s*\n\s*RETURNING/)
  })

  it("answers which urls a job made at or after each url's moment links, through the index (decided 2026-10-09)", () => {
    const fn = code.match(/FUNCTION public\.urls_linked_by_jobs_since\([\s\S]*?\$\$;/)
    expect(fn).not.toBeNull()
    // Each url paired with its own moment, not one moment for the batch.
    expect(fn![0]).toMatch(/unnest\(p_urls, p_since\) AS x\(url, since\)/)
    // The partial index's predicate and expression, so the probe never scans jobs.
    expect(fn![0]).toMatch(/j\.output_data IS NOT NULL/)
    expect(fn![0]).toMatch(/public\.job_output_urls\(j\.output_data\) && ARRAY\[x\.url\]/)
    // At or after the moment; no moment counts every job (keep when unsure).
    expect(fn![0]).toMatch(/j\.created_at >= coalesce\(x\.since, '-infinity'::timestamptz\)/)
    expect(fn![0]).toMatch(/LANGUAGE sql STABLE/)
  })

  it("leaves the index expression executable by every role (an index expression runs as the writer)", () => {
    expect(code).not.toMatch(/REVOKE[^;]*job_output_urls\(jsonb\)/)
    expect(code).toMatch(/LANGUAGE sql IMMUTABLE/)
  })

  it("never runs as the definer, and pins its search_path", () => {
    expect(code).not.toMatch(/SECURITY DEFINER/)
    const functions = code.match(/CREATE OR REPLACE FUNCTION/g) ?? []
    const pinned = code.match(/SET search_path = public/g) ?? []
    expect(pinned.length).toBe(functions.length)
  })

  it("indexes only rows with an output, and bounds what it indexes", () => {
    expect(code).toMatch(/CREATE INDEX IF NOT EXISTS idx_jobs_output_urls\s+ON public\.jobs USING gin \(public\.job_output_urls\(output_data\)\)\s+WHERE output_data IS NOT NULL;/)
    // Long strings (transcripts, model text) would fail the write that made a GIN entry too large.
    expect(code).toMatch(/octet_length\(t\.s\) <= 2048/)
    // Not CONCURRENTLY: `supabase db push` wraps every file in a transaction.
    expect(code).not.toMatch(/CONCURRENTLY/)
  })
})

/**
 * Migration 496 (decided 2026-10-08, rounds 11 and 12): the record of files a
 * storage delete failed (`lib/storage-delete.ts`, `lib/storage-delete-retries.ts`).
 */
const retriesSql = readFileSync(join(HERE, "../../../supabase/migrations/496_storage_delete_retries.sql"), "utf8")
const retriesCode = retriesSql.replace(/--.*$/gm, "")
const retriesCaller = readFileSync(join(HERE, "../lib/storage-delete.ts"), "utf8") + readFileSync(join(HERE, "../lib/storage-delete-retries.ts"), "utf8")

describe("migration 496 — storage delete retries", () => {
  it("is service-role only: RLS on, no policy, nothing granted to the client roles", () => {
    expect(retriesCode).toMatch(/ALTER TABLE public\.storage_delete_retries ENABLE ROW LEVEL SECURITY;/)
    expect(retriesCode).not.toMatch(/CREATE POLICY/i)
    expect(retriesCode).toMatch(/REVOKE ALL ON public\.storage_delete_retries FROM PUBLIC, anon, authenticated;/)
    expect(retriesCode).not.toMatch(/GRANT[^;]*TO[^;]*(anon|authenticated)/)
  })

  it("every source the backend writes passes the table's source check", () => {
    const check = retriesCode.match(/CHECK \(source ~ '([^']+)'\)/)
    expect(check).not.toBeNull()
    const pattern = new RegExp(check![1]!)
    const union = retriesCaller.match(/export type DeleteSource =([\s\S]*?)\n\n/)
    expect(union).not.toBeNull()
    const sources = [...union![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!)
    expect(sources.length).toBeGreaterThan(10)
    for (const s of sources) expect(s, s).toMatch(pattern)
  })

  it("is owner-agnostic: keyed by the storage key, with no user column", () => {
    expect(retriesCode).toMatch(/r2_key\s+text PRIMARY KEY/)
    expect(retriesCode).not.toMatch(/user_id/)
  })

  it("has every column the backend reads or writes", () => {
    const columns = ["r2_key", "url", "source", "job_id", "attempts", "last_error", "created_at", "failed_at", "last_attempt_at", "gave_up_at"]
    for (const c of columns) expect(retriesCode).toMatch(new RegExp(`\\n\\s+${c}\\s+\\w+`))
    for (const c of ["r2_key", "url", "source", "job_id", "attempts", "failed_at", "last_attempt_at", "gave_up_at", "last_error"]) {
      expect(retriesCaller).toContain(c)
    }
  })
})

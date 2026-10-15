// @test-watches supabase/migrations/.sequence supabase/migrations/528_assets_recorded_reference.sql supabase/tests/assets-recorded-reference.behavior.sql
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { RECORDED_REFERENCE_SHAPES } from "../lib/key-ownership.js"

/**
 * Migration 528 (decided 2026-10-15): `assets.recorded_reference`, computed by
 * the database at insert and immutable afterwards. The behavior proof
 * (`supabase/tests/assets-recorded-reference.behavior.sql`) runs it against a
 * real Postgres in CI; this holds its text to the shape the backend relies on,
 * and its classification to the backend's twin (`recordedReferenceByShape`).
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(HERE, "../../../supabase/migrations/528_assets_recorded_reference.sql"), "utf8")
const proof = readFileSync(join(HERE, "../../../supabase/tests/assets-recorded-reference.behavior.sql"), "utf8")
const sequence = readFileSync(join(HERE, "../../../supabase/migrations/.sequence"), "utf8").trim()
/** The statements, comments removed. */
const code = sql.replace(/--.*$/gm, "")

const SIG = "public.asset_recorded_reference_by_shape(text, uuid, bigint, uuid, uuid, text, text)"
const esc = (s: string) => s.replace(/[$()*+./?[\\\]^{|}-]/g, "\\$&")
const at = (re: RegExp) => {
  const m = re.exec(code)
  expect(m, String(re)).not.toBeNull()
  return m!.index
}

describe("migration 528 — assets.recorded_reference", () => {
  it("is the sequence's latest number", () => {
    expect(Number(sequence)).toBeGreaterThanOrEqual(528)
  })

  it("adds the column, then backfills it with assets_updated_at held off, then makes it NOT NULL DEFAULT false", () => {
    const added = at(/ALTER TABLE public\.assets ADD COLUMN IF NOT EXISTS recorded_reference boolean;/)
    const off = at(/ALTER TABLE public\.assets DISABLE TRIGGER assets_updated_at;/)
    const backfill = at(/UPDATE public\.assets\s+SET recorded_reference = public\.asset_recorded_reference_by_shape\(\s*r2_key, job_id, size_bytes, pipeline_id, pipeline_entity_id, relay_job_id, upload_source\s*\)\s+WHERE recorded_reference IS NULL;/)
    const on = at(/ALTER TABLE public\.assets ENABLE TRIGGER assets_updated_at;/)
    const notNull = at(/ALTER COLUMN recorded_reference SET NOT NULL;/)
    at(/ALTER COLUMN recorded_reference SET DEFAULT false;/)
    expect(added < off && off < backfill && backfill < on && on < notNull).toBe(true)
  })

  it("the classifier is the service role's only", () => {
    expect(code).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${esc(SIG)} FROM PUBLIC, anon, authenticated;`))
    expect(code).toMatch(new RegExp(`GRANT\\s+EXECUTE ON FUNCTION ${esc(SIG)} TO service_role;`))
    for (const fn of ["assets_stamp_recorded_reference", "assets_recorded_reference_immutable"]) {
      expect(code).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC, anon, authenticated;`))
    }
  })

  it("stamps every insert, adding to (never clearing) what a writer set, after the pipeline triggers", () => {
    expect(code).toMatch(
      /CREATE TRIGGER trg_assets_recorded_reference_stamp\s+BEFORE INSERT ON public\.assets\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.assets_stamp_recorded_reference\(\);/,
    )
    expect(code).toMatch(/NEW\.recorded_reference := coalesce\(NEW\.recorded_reference, false\)\s+OR public\.asset_recorded_reference_by_shape\(/)
    // BEFORE triggers fire in name order: after 121's denorm and 480's owner check.
    expect(["assets_pipeline_denorm", "trg_assets_pipeline_owner", "trg_assets_recorded_reference_stamp"].sort()).toEqual([
      "assets_pipeline_denorm",
      "trg_assets_pipeline_owner",
      "trg_assets_recorded_reference_stamp",
    ])
  })

  it("freezes the flag, the owner and the key after insert, for every writer, and only after the backfill", () => {
    const trigger = at(
      /CREATE TRIGGER trg_assets_recorded_reference_immutable\s+BEFORE UPDATE OF recorded_reference, user_id, r2_key ON public\.assets/,
    )
    expect(trigger).toBeGreaterThan(at(/WHERE recorded_reference IS NULL;/))
    const fn = code.match(/FUNCTION public\.assets_recorded_reference_immutable\(\)[\s\S]*?\$\$;/)![0]
    expect(fn).toMatch(/NEW\.recorded_reference IS DISTINCT FROM OLD\.recorded_reference/)
    expect(fn).toMatch(/NEW\.user_id IS DISTINCT FROM OLD\.user_id/)
    expect(fn).toMatch(/NEW\.r2_key IS NOT NULL AND NEW\.r2_key IS DISTINCT FROM OLD\.r2_key/)
    expect(fn.match(/ERRCODE = '42501'/g)).toHaveLength(3)
    expect(fn).not.toMatch(/SECURITY DEFINER|current_user|session_user|service_role/)
  })

  it("classifies with the backend twin's sources and key shapes", () => {
    const fn = code.match(/FUNCTION public\.asset_recorded_reference_by_shape\([\s\S]*?\$\$;/)![0]
    const sources = /NOT IN\s*\(([^)]*)\)/.exec(fn)![1]!.match(/'([a-z_]+)'/g)!.map((s) => s.slice(1, -1))
    expect(sources.sort()).toEqual([...RECORDED_REFERENCE_SHAPES.storingSources].sort())
    // The JS regexes, read as the SQL spells them (POSIX ARE, case-blind `~*`).
    const asSql = (re: RegExp) => re.source.replace(/\(\?:/g, "(").replace(/\\\//g, "/")
    expect(RECORDED_REFERENCE_SHAPES.uploadKey.flags).toContain("i")
    expect(RECORDED_REFERENCE_SHAPES.outputKey.flags).toContain("i")
    expect(fn).toContain(`p_r2_key !~* '${asSql(RECORDED_REFERENCE_SHAPES.uploadKey)}'`)
    expect(fn).toContain(`p_r2_key !~* '${asSql(RECORDED_REFERENCE_SHAPES.outputKey)}'`)
  })

  it("the behavior proof asserts every insert case and the immutability", () => {
    expect(proof).toMatch(/ALL BEHAVIOR ASSERTIONS PASSED/)
    expect(proof).toMatch(/ROLLBACK;\s*$/)
    for (const label of [
      "the attached image is still a recorded reference once its entity is gone",
      "the pipeline image is still a recorded reference once its pipeline is gone",
      "rewriting upload_source leaves the flag",
      "the flag cannot be cleared after insert",
      "a row cannot be re-pointed at another key",
      "a row never changes hands",
      "authenticated cannot execute the classifier",
    ]) {
      expect(proof).toContain(label)
    }
  })
})

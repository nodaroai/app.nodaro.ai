// @test-watches supabase/migrations/*.sql
/**
 * The share rule is written twice: in TypeScript for a single job and a page
 * of items (shared-job.ts), and in SQL for the counts and covers
 * (`share_link_session_summaries`, migration 680). This holds the SQL to every
 * condition the TypeScript side names, so neither can drift alone, and every
 * column the share reads select to the schema the migrations build.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { GALLERY_BLOCKED_WORDS } from "../../../config/content-filter.js"
import { jobsColumns, tableColumns } from "../../__tests__/jobs-schema.js"
import { CONTENT_FILTER_TEXT_FIELDS, MEDIA_OUTPUT_KEYS, PRIVATE_INPUT_FLAGS, SHARE_JOB_COLUMNS } from "../shared-job.js"

const MIGRATION = resolve(__dirname, "../../../../../supabase/migrations/680_share_links.sql")

/** The summaries function's body, comments stripped. */
function summariesBody(): string {
  const sql = readFileSync(MIGRATION, "utf8").replace(/--[^\n]*/g, "")
  const m = /FUNCTION public\.share_link_session_summaries[\s\S]*?AS \$\$([\s\S]*?)\$\$;/.exec(sql)
  if (!m) throw new Error("share_link_session_summaries not found in 680_share_links.sql")
  return m[1]!.replace(/\s+/g, " ")
}

describe("share_link_session_summaries applies the share rule", () => {
  const body = summariesBody()

  it.each([
    ["a live item", "i.removed_at IS NULL"],
    ["a job not in the Trash", "j.deleted_at IS NULL"],
    ["a completed job", "j.status = 'completed'"],
    ["a top-level job", "j.parent_job_id IS NULL"],
    ["a job not restricted", "j.restricted_at IS NULL"],
    ["a job not kept private", "j.force_private IS NOT TRUE"],
    ["the session owner's job", "j.user_id = s.user_id"],
  ])("%s", (_what, condition) => {
    expect(body).toContain(condition)
  })

  it("reads every input flag that keeps a job private", () => {
    for (const flag of PRIVATE_INPUT_FLAGS) expect(body).toContain(`(j.input_data -> '${flag}') IS DISTINCT FROM 'true'::jsonb`)
  })

  it("reads every text the content filter reads, and the job's name", () => {
    for (const field of CONTENT_FILTER_TEXT_FIELDS) expect(body).toContain(`j.input_data ->> '${field}'`)
    expect(body).toContain("j.title")
  })

  it("asks for every media key a link shows", () => {
    for (const [, one, many] of MEDIA_OUTPUT_KEYS) {
      expect(body).toContain(`coalesce(j.output_data ->> '${one}', '') ~* '^https?://'`)
      expect(body).toContain(`coalesce(j.output_data -> '${many}' ->> 0, '') ~* '^https?://'`)
    }
  })

  it("is given the content filter's words in the form it compares (lower case, none empty)", () => {
    for (const word of GALLERY_BLOCKED_WORDS) {
      expect(word).toBe(word.toLowerCase())
      expect(word.length).toBeGreaterThan(0)
    }
  })
})

describe("the share reads name columns the schema has", () => {
  it("every jobs column a share read selects exists", () => {
    const columns = jobsColumns()
    for (const col of SHARE_JOB_COLUMNS.split(",").map((c) => c.trim())) expect(columns.has(col), col).toBe(true)
    expect(columns.has("title")).toBe(true)
  })

  it("share_links has the columns the store reads and writes", () => {
    const columns = tableColumns("share_links")
    for (const col of ["id", "token", "owner_id", "kind", "target_id", "allow_copy", "created_at", "updated_at", "revoked_at"]) {
      expect(columns.has(col), col).toBe(true)
    }
  })
})

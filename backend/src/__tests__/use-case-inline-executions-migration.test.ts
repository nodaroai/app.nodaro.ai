/**
 * Migration 509 — inline (use-case) executions. A use-case node runs a graph
 * the server builds, with no saved workflow: the execution row carries the
 * graph snapshot and points at the job that wraps it. Static checks on the
 * SQL; the real-Postgres proof is supabase/tests/use-case-inline-executions.behavior.sql.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"

const REPO_ROOT = join(__dirname, "..", "..", "..")
const sql = readFileSync(join(REPO_ROOT, "supabase", "migrations", "509_use_case_inline_executions.sql"), "utf8")

describe("migration 509 — inline use-case executions", () => {
  it("adds the snapshot and the wrapper pointer, idempotently", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS inline_graph jsonb/i)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS wrapper_job_id uuid REFERENCES public\.jobs\(id\) ON DELETE SET NULL/i)
  })

  it("lets an execution have no workflow only when it carries a graph", () => {
    expect(sql).toMatch(/ALTER COLUMN workflow_id DROP NOT NULL/i)
    expect(sql).toMatch(/CHECK \(workflow_id IS NOT NULL OR inline_graph IS NOT NULL\) NOT VALID/i)
    expect(sql).toMatch(/CHECK \(inline_graph IS NULL OR jsonb_typeof\(inline_graph\) = 'object'\) NOT VALID/i)
  })

  it("re-declares every earlier trigger lane and adds use_case", () => {
    const m = sql.match(/ADD CONSTRAINT workflow_executions_trigger_type_check\s+CHECK \(trigger_type IN\s*\(([^)]*)\)\)/i)
    expect(m).not.toBeNull()
    const lanes = m![1]!.split(",").map((s) => s.trim().replace(/'/g, "")).sort()
    expect(lanes).toEqual(["api", "app_run", "manual", "mcp", "schedule", "telegram", "telegram_account", "use_case", "webhook"])
  })

  it("seeds the Tighten Episode fee at 10 credits without overwriting an admin edit", () => {
    expect(sql).toMatch(/\('use-case-fee:tighten-episode',\s*10,\s*true,\s*'other'\)/)
    expect(sql).toMatch(/ON CONFLICT \(model_identifier\) DO NOTHING/i)
  })
})

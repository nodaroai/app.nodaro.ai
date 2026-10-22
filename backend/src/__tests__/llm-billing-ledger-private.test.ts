// @test-watches supabase/migrations/*.sql backend/src/**/*.ts
/**
 * The metered LLM billing ledger (`{ costUsd, source, calls, lanes }` — the
 * provider's own dollar cost and the serving lanes) must never reach a user.
 *
 * It lives in the server-only column `jobs.llm_billing` (migration 552), NOT in
 * `output_data`: migration 347 grants `authenticated` SELECT on (id, user_id,
 * status, output_data) for the Realtime feed, so any key in `output_data` is
 * readable by the job's owner straight over PostgREST, whatever the API's own
 * serializers redact. Pinned here:
 *  1. no migration grants `llm_billing` to anon / authenticated, and 552 revokes it;
 *  2. the only backend source that names the column is a reasoned allowlist of
 *     server-only readers/writers — a new user-facing serializer cannot select
 *     it without being added here, deliberately;
 *  3. the user-facing job serializers drop the column and never carry a `costUsd`.
 * (That the settle writes the ledger to the column and never to `output_data`
 * is pinned in ee/billing/__tests__/llm-billing.test.ts.)
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: {}, tryRemoveFromQueue: vi.fn(), redis: {} }))

const { sanitizeJobForPublic } = await import("../routes/jobs.js")
const { jobView } = await import("../lib/mcp/tools/_job-view.js")
const { JOB_EVENT_COLUMNS } = await import("../lib/webhooks/event.js")
const { LLM_BILLING_LEDGER_COLUMN } = await import("../lib/llm-billing.js")

const SRC = join(__dirname, "..")
const MIGRATIONS = join(__dirname, "..", "..", "..", "supabase", "migrations")

/** Backend sources that may name the ledger column — each server-only, with why. */
const LEDGER_READERS: Record<string, string> = {
  "lib/llm-billing-ledger.ts": "THE helper: declares the column, reads and writes it by job id (service role)",
  "lib/llm-billing.ts": "re-exports the helper for the shim's callers",
  "ee/billing/llm-billing-impl.ts": "the settle writes the ledger; the reconcile sweep reads it (service role)",
  "lib/llm-metered-schema-probe.ts": "R33: selects the column on zero rows to learn it exists (service role)",
  "lib/llm-metered-schema-gate.ts": "R33: names the column in its docs only",
  "lib/reconcile/cancelled-metered-holds.ts": "the cancelled-hold sweep: selects the cancelled rows that carry a ledger (a scrape's fixed + calls hold, N1) — service role, never answered to a user",
  "ee/routes/admin-credit-audit-llm.ts": "D6 cost monitoring: the admin-only (requireAdmin) credit audit's LLM mode bulk-reads the ledgers' costUsd/source/chargeId (service role)",
}

/**
 * A line of product code that puts a `billing` key into `output_data`, or
 * reads one off it: `output_data: { …, billing: … }`, `outputData.billing`,
 * `output_data?.billing`. Comments are skipped.
 */
function outputDataBillingLines(source: string): string[] {
  return source.split("\n").filter((line) => {
    const code = line.trim()
    if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return false
    if (/\b(?:output_data|outputData|output)\s*\??\.\s*billing\b/.test(code)) return true
    return /\b(?:output_data|outputData)\b/.test(code) && /[{,\s]billing\s*[:},]/.test(code)
  })
}

/**
 * The multi-line form the line scan cannot see: an `output_data: { … }`
 * object literal whose body (balanced braces, comments stripped) carries a
 * `billing:` key on a later line, e.g. a completion's
 * `...(settled ? { billing: settled.billing } : {})` spread.
 */
function outputDataBillingObjects(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")
  const hits: string[] = []
  for (const m of code.matchAll(/\b(?:output_data|outputData)\s*:\s*\{/g)) {
    const start = m.index! + m[0].length - 1
    let depth = 0
    let end = start
    for (; end < code.length; end++) {
      if (code[end] === "{") depth++
      else if (code[end] === "}" && --depth === 0) break
    }
    const body = code.slice(start + 1, end)
    if (/(?:^|[{,\s])billing\s*:/.test(body)) hits.push(code.slice(m.index!, Math.min(end + 1, m.index! + 160)).replace(/\s+/g, " "))
  }
  return hits
}

/** Backend sources that may read a WHOLE jobs row (which includes llm_billing) — each server-only, with why. None today. */
const WHOLE_ROW_JOB_READERS: Record<string, string> = {}

/** The migration after which the jobs table is column-granted only (347 revoked table-level SELECT). */
const COLUMN_GRANT_FLOOR = 347

/**
 * Whole-row reads of `jobs` (they would carry `llm_billing` through the
 * service role): `.from("jobs")…select("*" | no arg)`, including a `.select()`
 * after an insert/update, and a `jobs(*)` / `jobs:fk(*)` / `jobs!fk(*)` embed
 * in any select. A `head: true` count reads no rows and is allowed.
 */
function wholeRowJobReads(source: string): string[] {
  const hits: string[] = []
  const chain = /\.from\(\s*["'`]jobs["'`]\s*\)((?:(?!\.from\()[\s\S]){0,1500}?)\.select\(\s*(?:(["'`])([\s\S]*?)\2)?\s*(,\s*\{[^}]*\})?\s*\)/g
  for (const m of source.matchAll(chain)) {
    const cols = m[3]
    const opts = m[4] ?? ""
    if (/head\s*:\s*true/.test(opts)) continue
    if (cols === undefined || /(^|,)\s*\*\s*(,|$)/.test(cols)) hits.push(m[0].replace(/\s+/g, " ").slice(0, 160))
  }
  for (const m of source.matchAll(/\bjobs(?:[:!][A-Za-z_]+)*\s*\(\s*\*\s*\)/g)) hits.push(m[0])
  return hits
}

/** Table-level grants that would re-expose EVERY jobs column (llm_billing included) to a client role. */
function tableLevelClientGrants(sql: string): string[] {
  const client = /\b(?:authenticated|anon|PUBLIC)\b/i
  const out: string[] = []
  for (const stmt of sql.split(";")) {
    const s = stmt.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim()
    if (!/\bGRANT\b/i.test(s)) continue
    const toClient = /\bTO\b(.*)$/i.exec(s)
    if (!toClient || !client.test(toClient[1]!)) continue
    const privs = /\bGRANT\s+(.*?)\s+ON\b/i.exec(s)?.[1] ?? ""
    const readsAll = /\b(?:SELECT|ALL)\b/i.test(privs) && !/\bSELECT\s*\(/i.test(privs)
    if (!readsAll) continue
    if (/\bON\s+(?:TABLE\s+)?(?:public\.)?jobs\b/i.test(s) || /\bON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+public\b/i.test(s) ||
        (/\bALTER\s+DEFAULT\s+PRIVILEGES\b/i.test(s) && /\bON\s+TABLES\b/i.test(s))) {
      out.push(s.slice(0, 200))
    }
  }
  return out
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sourceFiles(p, out)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const ledger = { costUsd: 0.048, source: "kie-stated", calls: 1, lanes: ["kie"] }
const row = {
  id: "j1",
  status: "completed",
  progress: 100,
  input_data: { prompt: "x" },
  output_data: { text: "the answer" },
  error_message: null,
  created_at: "2026-10-20T10:00:00Z",
  started_at: "2026-10-20T10:00:01Z",
  completed_at: "2026-10-20T10:00:09Z",
  user_id: "u1",
  credits: 27,
  credits_actual: 27,
  job_type: "llm-chat",
  provider: "kie",
  provider_cost: 0.048,
  llm_billing: ledger,
}

describe("the metered LLM billing ledger stays server-only", () => {
  it("lives in jobs.llm_billing", () => {
    expect(LLM_BILLING_LEDGER_COLUMN).toBe("llm_billing")
  })

  it("no migration grants llm_billing to anon or authenticated; 552 revokes it", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))
    const grants = files.flatMap((f) =>
      [...readFileSync(join(MIGRATIONS, f), "utf8").matchAll(/GRANT\s+SELECT\s*\(([^)]*)\)\s+ON\s+(?:TABLE\s+)?public\.jobs\s+TO\s+([^;]+);/gi)]
        .filter((m) => /\bllm_billing\b/.test(m[1]!))
        .map((m) => `${f}: ${m[0]}`),
    )
    expect(grants).toEqual([])
    const m549 = readFileSync(join(MIGRATIONS, "552_jobs_llm_billing_ledger.sql"), "utf8")
    expect(m549).toMatch(/REVOKE SELECT \(llm_billing\) ON public\.jobs FROM PUBLIC, anon, authenticated;/)
    // 347's browser grant is a short column list that does not name it.
    const m347 = readFileSync(join(MIGRATIONS, "347_jobs_cost_columns_and_private_by_default.sql"), "utf8")
    expect(m347).toMatch(/GRANT SELECT \(id, user_id, status, output_data\) ON TABLE public\.jobs TO authenticated;/)
  })

  it("no migration after 347 grants a client role the whole jobs table (a table grant re-exposes every column)", () => {
    const offenders = readdirSync(MIGRATIONS)
      .filter((f) => /^\d+_.*\.sql$/.test(f) && Number.parseInt(f, 10) > COLUMN_GRANT_FLOOR)
      .flatMap((f) => tableLevelClientGrants(readFileSync(join(MIGRATIONS, f), "utf8")).map((g) => `${f}: ${g}`))
    expect(offenders).toEqual([])
  })

  it("the table-grant scan recognises every shape it must refuse (and nothing else)", () => {
    for (const bad of [
      "GRANT SELECT ON TABLE public.jobs TO authenticated;",
      "GRANT SELECT ON jobs TO anon;",
      "GRANT ALL ON public.jobs TO PUBLIC;",
      "GRANT ALL PRIVILEGES ON TABLE public.jobs TO authenticated;",
      "GRANT SELECT, INSERT ON public.jobs TO authenticated;",
      "GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;",
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO authenticated;",
    ]) {
      expect(tableLevelClientGrants(bad), bad).toHaveLength(1)
    }
    for (const fine of [
      "GRANT SELECT (id, user_id, status, output_data) ON TABLE public.jobs TO authenticated;",
      "GRANT SELECT ON TABLE public.jobs TO service_role;",
      "GRANT SELECT ON public.job_ratings TO authenticated;",
      "REVOKE SELECT ON TABLE public.jobs FROM authenticated;",
      "GRANT EXECUTE ON FUNCTION public.x() TO authenticated;",
    ]) {
      expect(tableLevelClientGrants(fine), fine).toEqual([])
    }
  })

  it("no backend source reads a whole jobs row unless it is a reasoned server-only reader", () => {
    const offenders = sourceFiles(SRC)
      .map((f) => ({ rel: relative(SRC, f).split("\\").join("/"), hits: wholeRowJobReads(readFileSync(f, "utf8")) }))
      .filter((f) => f.hits.length > 0 && !(f.rel in WHOLE_ROW_JOB_READERS))
      .map((f) => `${f.rel}: ${f.hits.join(" | ")}`)
    expect(
      offenders,
      "A whole jobs row carries jobs.llm_billing (the provider's cost). Name the columns you need — or, for a server-only reader, add it to WHOLE_ROW_JOB_READERS with its reason.",
    ).toEqual([])
  })

  it("the whole-row scan recognises every shape it must refuse (and nothing else)", () => {
    for (const bad of [
      'supabase.from("jobs").select("*").eq("id", id)',
      'supabase.from("jobs").select().eq("id", id)',
      'supabase.from("jobs").insert(row).select().single()',
      'supabase.from("jobs").update({ status }).eq("id", id).select()',
      'supabase.from("jobs").select("*, workflow_executions(id)")',
      'supabase.from("assets").select("id, jobs(*)")',
      'supabase.from("gallery_reports").select("*, jobs:job_id(*)")',
    ]) {
      expect(wholeRowJobReads(bad), bad).toHaveLength(1)
    }
    for (const fine of [
      'supabase.from("jobs").select("id, status, output_data")',
      'supabase.from("jobs").select("*", { count: "exact", head: true })',
      'supabase.from("jobs").select("id", { count: "exact" })',
      'supabase.from("assets").select("*")',
      'supabase.from("gallery_reports").select("*, jobs:job_id(id, job_type, output_data)")',
    ]) {
      expect(wholeRowJobReads(fine), fine).toEqual([])
    }
  })

  it("only the reasoned server-only files name the column", () => {
    const naming = sourceFiles(SRC)
      .filter((f) => /\bllm_billing\b|LLM_BILLING_LEDGER_COLUMN/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f).split("\\").join("/"))
      .sort()
    expect(
      naming,
      "A new reader of jobs.llm_billing must be server-only (admin tooling, monitoring, settlement) — add it to LEDGER_READERS with its reason. A user-facing job serializer must never select it.",
    ).toEqual(Object.keys(LEDGER_READERS).sort())
  })

  it("no product code writes a billing ledger into output_data, or reads one off it", () => {
    const offenders = sourceFiles(SRC).flatMap((f) => {
      const source = readFileSync(f, "utf8")
      const rel = relative(SRC, f).split("\\").join("/")
      return [
        ...outputDataBillingLines(source).map((line) => `${rel}: ${line.trim()}`),
        ...outputDataBillingObjects(source).map((obj) => `${rel}: ${obj}`),
      ]
    })
    expect(
      offenders,
      "output_data is readable by the job's owner (migration 347's grant): the billing ledger goes in jobs.llm_billing, through lib/llm-billing-ledger.ts (readLlmBillingLedger / writeLlmBillingLedger / isLlmBillingLedger).",
    ).toEqual([])
  })

  it("the multi-line output_data scan sees a billing key on a later line of the literal (and nothing else)", () => {
    for (const bad of [
      [
        "markJobCompleted(id, {",
        "  output_data: {",
        "    script,",
        "    ...(settled.billing !== undefined ? { billing: settled.billing } : {}),",
        "  },",
        "})",
      ].join("\n"),
      ["update({", "  output_data: {", '    stage: "drafting",', "    billing: ledger,", "  },", "})"].join("\n"),
    ]) {
      expect(outputDataBillingObjects(bad), bad).toHaveLength(1)
    }
    for (const fine of [
      ["update({", "  output_data: {", '    stage: "drafting",', "    // billing: never here", "  },", "  provider_cost: cost,", "})"].join("\n"),
      ["update({ output_data: { text } })", "const billing: WorkerLlmBilling = x"].join("\n"),
      ["toolkit({", "  output_data: { text },", "  billingContext: ctx,", "})"].join("\n"),
    ]) {
      expect(outputDataBillingObjects(fine), fine).toEqual([])
    }
  })

  it("the output_data scan recognises every shape it must refuse (and nothing else)", () => {
    for (const bad of [
      "output_data: record ? { ...result, billing: { ...record } } : result,",
      "output_data: { script, ...(settled ? { billing: settled.billing } : {}) },",
      "const metered = isMeteredBillingLedger(outputData.billing)",
      "const l = row.output_data?.billing",
      "output_data: { text, billing },",
    ]) {
      expect(outputDataBillingLines(bad), bad).toHaveLength(1)
    }
    for (const fine of [
      "// output_data.billing used to hold the ledger",
      "const { billingContext } = req",
      "output_data: { text: \"x\" }, billing_status: 1",
      "await writeLlmBillingLedger(jobId, billing)",
    ]) {
      expect(outputDataBillingLines(fine), fine).toEqual([])
    }
  })

  it("the REST job serializer drops the ledger for every caller, and a user never sees a cost", () => {
    for (const isAdmin of [false, true]) {
      const out = sanitizeJobForPublic(row as never, isAdmin) as Record<string, unknown>
      // The fixture row carries the ledger column: the serializer must drop it.
      expect(out).not.toHaveProperty("llm_billing")
      expect(JSON.stringify(out)).not.toMatch(/costUsd/)
    }
    const user = sanitizeJobForPublic(row as never, false)
    expect(JSON.stringify(user)).not.toMatch(/costUsd|provider_cost|llm_billing/)
  })

  it("the MCP job view and the webhook payload columns carry no ledger and no cost", () => {
    const view = jobView(row as never)
    expect(JSON.stringify(view)).not.toMatch(/costUsd|llm_billing|provider_cost/)
    expect(JOB_EVENT_COLUMNS.split(/,\s*/)).not.toContain("llm_billing")
    expect(JOB_EVENT_COLUMNS.split(/,\s*/)).not.toContain("provider_cost")
  })
})

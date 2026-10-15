// @test-watches backend/src/**/*.ts
/**
 * Every place that reads what a run cost reads the CHARGE through one reader.
 *
 * `usage_logs.credits_used` (and `jobs.credits`) is the HOLD taken when a run
 * is accepted; it never changes. A run can settle below it — a re-render
 * ceiling, a measured length, a metered run — and the rest goes back to the
 * balance. A surface that sums or shows `credits_used` as spend over-reports
 * every such run (the transaction list and the job payload once did).
 *
 * The charge is read by `lib/usage-amount.ts` (`usageAmount` /
 * `settledCharge`), or by `lib/job-credit-status.ts`, which reads through it.
 * Its SQL twin, `public.usage_log_charge`, is pinned to the same case table
 * (supabase/tests/usage-charge.behavior.sql).
 *
 * Two checks, both data-driven:
 *  1. Every backend source file that selects `credits_used` from `usage_logs`
 *     reads through the charge reader, or is listed in HOLD_READERS with the
 *     reason it needs the hold itself (settlement mechanics, budget holds).
 *     A new reader fails here until it decides which it is.
 *  2. The known user-facing credit surfaces import the reader.
 */
import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "..")

/** Files that need the HOLD itself, never shown to a person as spend. */
const HOLD_READERS: Record<string, string> = {
  "ee/billing/credits.ts": "reservation and settlement mechanics: refunds and commits move the hold",
  "workers/shared.ts": "settlement: the hold is the ceiling a measured or metered actual is clamped to",
  "lib/job-policy-gate.ts": "a policy budget counts what is HELD by in-flight runs",
  "lib/credits-job-lifecycle.ts":
    "jobCreditHolds: a batch job's live holds — which one a job keeps after a race, and the job's credits column pointed back at that hold",
  "lib/reconcile/bump-attempts.ts": "an anomaly row records the reservation it is about",
  "ee/scripts/topaz-overcharge-refund.ts": "one-off repair script comparing holds to a corrected price",
  "ee/notifications/credits-digest.ts":
    "admin digest: counts open holds as in-flight, and reads committed rows with the same rule inline over string-typed numeric columns (aggregateUsage is unit-tested)",
}

/** The surfaces a person or an admin reads spend from, and the reader each must use. */
const CHARGE_SURFACES: Record<string, RegExp> = {
  "lib/usage-transactions.ts": /from "\.\/usage-amount\.js"/, // the usage rows both lists below read
  "ee/routes/credits-balance.ts": /from "\.\.\/\.\.\/lib\/usage-transactions\.js"/, // GET /v1/credits/transactions
  "lib/mcp/tools/models.ts": /from "\.\.\/\.\.\/usage-transactions\.js"/, // MCP credit_transactions
  "routes/jobs.ts": /from "\.\.\/lib\/job-credit-status\.js"/, // GET /v1/jobs, GET /v1/jobs/:id
  "lib/mcp/tools/jobs.ts": /from "\.\.\/\.\.\/job-credit-status\.js"/, // get_job, list_jobs, wait_for_job
  "lib/webhooks/event.ts": /from "\.\.\/job-credit-status\.js"/, // the job in an outbound webhook event
  "ee/routes/admin-credit-audit.ts": /from "\.\.\/\.\.\/lib\/usage-amount\.js"/, // admin credit audit
  "lib/job-credit-status.ts": /from "\.\/usage-amount\.js"/,
}

const READS_THE_CHARGE = /from "(?:\.\.?\/)+(?:lib\/)?(?:usage-amount|job-credit-status)\.js"/

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules") continue
      sourceFiles(p, out)
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".d.ts")) {
      out.push(p)
    }
  }
  return out
}

/** Each `.from("usage_logs") … .select("…")` column list in a file (up to the next `.from(`). */
function usageLogSelects(source: string): string[] {
  const re = /\.from\(\s*["'`]usage_logs["'`]\s*\)((?:(?!\.from\()[\s\S]){0,1500}?)\.select\(\s*(["'`])([\s\S]*?)\2/g
  return Array.from(source.matchAll(re), (m) => m[3])
}

const FILES = sourceFiles(SRC).map((abs) => ({ rel: relative(SRC, abs).split("\\").join("/"), text: readFileSync(abs, "utf8") }))
const HOLD_SELECTORS = FILES.filter((f) => usageLogSelects(f.text).some((cols) => /\bcredits_used\b/.test(cols)))

describe("credit surfaces read the charge, not the hold", () => {
  it("finds the usage_logs readers it guards (the scan is not vacuous)", () => {
    expect(HOLD_SELECTORS.map((f) => f.rel)).toEqual(expect.arrayContaining(["lib/usage-transactions.ts", "workers/shared.ts"]))
  })

  for (const f of HOLD_SELECTORS) {
    it(`${f.rel} reads the charge through usage-amount, or is a declared hold reader`, () => {
      const declared = f.rel in HOLD_READERS
      const readsCharge = READS_THE_CHARGE.test(f.text)
      expect(
        declared || readsCharge,
        `${f.rel} selects usage_logs.credits_used — the HOLD. Read what was charged through ` +
          "lib/usage-amount.ts (usageAmount / settledCharge), or add it to HOLD_READERS with the reason it needs the hold.",
      ).toBe(true)
    })
  }

  it("every declared hold reader still selects the hold (the list only shrinks)", () => {
    const selecting = new Set(HOLD_SELECTORS.map((f) => f.rel))
    expect(Object.keys(HOLD_READERS).filter((rel) => !selecting.has(rel))).toEqual([])
  })

  for (const [rel, importPattern] of Object.entries(CHARGE_SURFACES)) {
    it(`${rel} imports the charge reader`, () => {
      const file = FILES.find((f) => f.rel === rel)
      expect(file, `${rel} moved — update CHARGE_SURFACES`).toBeDefined()
      expect(importPattern.test(file!.text)).toBe(true)
    })
  }
})

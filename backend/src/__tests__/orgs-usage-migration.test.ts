/**
 * Per-file guard for the P15 usage-reporting migration (369, renumber-safe:
 * located by the `_orgs_usage_reporting.sql` suffix, so a renumber cannot
 * orphan it). Pins the invariants the routes, the CSV and the pricing-leak
 * class all depend on:
 *  - the four reader functions exist and return NO economics-shaped column;
 *  - `cost_usd` never leaves a comment;
 *  - both usage_logs readers filter `status <> 'refunded'`;
 *  - the variance index is partial on `source = 'org_usage_variance'`;
 *  - no CTE (the references guard would flag it) and the `LIMIT 5001`
 *    truncation contract the route relies on;
 *  - the SQL `p_group_by NOT IN (...)` list is exactly `USAGE_GROUP_BYS`
 *    minus `none` (one vocabulary — the plugin Zod is the other half);
 *  - the RAISE-prefix set is exactly the four the plugin's RPC_PREFIX_MAP maps;
 *  - all four definers are STABLE and the two usage_logs readers carry
 *    `#variable_conflict use_column`.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { USAGE_GROUP_BYS } from "@nodaro/shared"
import { describe, expect, it } from "vitest"

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "supabase", "migrations")

const ECONOMICS = /(cost|usd|margin|markup|price|dollar)/i

const matches = readdirSync(MIGRATIONS_DIR).filter((f) => /_orgs_usage_reporting\.sql$/.test(f))

describe("369 usage-reporting migration guard", () => {
  it("is located by suffix exactly once (renumber-safe)", () => {
    expect(matches).toHaveLength(1)
  })

  const file = matches[0]
  const raw = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
  // Comment-stripped copy for every check that must ignore documentation.
  const sql = raw.replace(/--[^\n]*/g, "")

  it("1. defines the four reader functions", () => {
    for (const name of ["window", "report", "rows", "variance"]) {
      expect(sql, `org_usage_${name} present`).toMatch(
        new RegExp(`CREATE OR REPLACE FUNCTION\\s+public\\.org_usage_${name}\\s*\\(`),
      )
    }
  })

  it("2. no RETURNS TABLE column is economics-shaped", () => {
    const lists = [...sql.matchAll(/RETURNS TABLE\s*\(([\s\S]*?)\)\s*\n?\s*LANGUAGE/gi)].map((m) => m[1])
    expect(lists.length).toBe(4)
    for (const list of lists) {
      expect(ECONOMICS.test(list), `no cost/usd/price token in: ${list.trim()}`).toBe(false)
    }
  })

  it("3. cost_usd never occurs outside a comment", () => {
    expect(sql).not.toMatch(/cost_usd/i)
  })

  it("4. both usage_logs readers filter status <> 'refunded'", () => {
    const hits = sql.match(/status\s*<>\s*'refunded'/g) ?? []
    expect(hits.length).toBeGreaterThanOrEqual(2)
  })

  it("5. the variance index is partial on source = 'org_usage_variance'", () => {
    const idx = sql.match(/CREATE INDEX[\s\S]*?idx_credit_tx_variance_org_created[\s\S]*?;/i)?.[0] ?? ""
    expect(idx).toMatch(/WHERE\s+source\s*=\s*'org_usage_variance'/i)
  })

  it("6. uses no CTE (the references guard would flag it)", () => {
    expect(sql).not.toMatch(/WITH\s+\w+\s+AS\s*\(/i)
  })

  it("7. org_usage_report carries the LIMIT 5001 truncation contract", () => {
    expect(sql).toMatch(/LIMIT\s+5001/i)
  })

  it("8. the SQL p_group_by NOT IN (...) list equals USAGE_GROUP_BYS minus none", () => {
    const clause = sql.match(/p_group_by\s+NOT IN\s*\(([^)]*)\)/i)?.[1] ?? ""
    const sqlList = [...clause.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
    const shared = USAGE_GROUP_BYS.filter((g) => g !== "none").slice().sort()
    expect(sqlList).toEqual(shared)
  })

  it("9. the RAISE-prefix set is exactly the four the plugin maps", () => {
    const prefixes = new Set([...sql.matchAll(/RAISE EXCEPTION\s+'([A-Z_]+):/g)].map((m) => m[1]))
    expect([...prefixes].sort()).toEqual(["BAD_GROUP_BY", "BAD_SCOPE", "INVALID_TIMEZONE", "RANGE_TOO_LARGE"])
  })

  it("10. all four definers are STABLE", () => {
    expect((sql.match(/LANGUAGE plpgsql/g) ?? []).length).toBe(4)
    expect((sql.match(/LANGUAGE plpgsql STABLE/g) ?? []).length).toBe(4)
  })

  it("11. the two usage_logs readers carry #variable_conflict use_column", () => {
    // The pragma is defensive (every reference is alias-qualified). It sits on
    // the two usage_logs readers; org_usage_variance's workspace_id also
    // collides with credit_transactions but is alias-qualified and omitted, so
    // the count is 2 (see the migration's Deviations note in the PR body).
    expect((raw.match(/#variable_conflict use_column/g) ?? []).length).toBe(2)
  })
})

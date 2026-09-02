/**
 * Per-file guard for the P15 usage-reporting migration (369, renumber-safe:
 * located by the `_orgs_usage_reporting.sql` suffix). Pins the invariants the
 * routes, the CSV, the totals and the pricing-leak class depend on:
 *  - the FIVE reader functions exist and return NO economics-shaped column;
 *  - `cost_usd` never leaves a comment;
 *  - the three usage_logs readers filter `status <> 'refunded'`;
 *  - the variance index is partial on `source = 'org_usage_variance'`;
 *  - no CTE (the references guard would flag it); the report's `LIMIT 5001`
 *    truncation contract; `org_usage_totals` is UNcapped (no GROUP BY / LIMIT);
 *  - the SQL `p_group_by NOT IN (...)` list is exactly `USAGE_GROUP_BYS` minus
 *    `none`; the RAISE-prefix set is exactly the five the plugin maps;
 *  - all five definers are STABLE; the three usage_logs readers carry
 *    `#variable_conflict use_column`;
 *  - `org_usage_variance` discriminates the two variance ledgers by the exact
 *    description prefixes migrations 351/352 write (so a reworded writer fails);
 *  - all four data readers (report/totals/rows/variance) narrow by `p_user_id`
 *    so a member self-view never subtracts another member's absorbed overrun
 *    (P15R-01: totals is narrowable, so the variance line must be too);
 *  - each `org_usage_*` function is defined in EXACTLY ONE migration (a later
 *    CREATE OR REPLACE elsewhere would escape these pins).
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { USAGE_GROUP_BYS } from "@nodaro/shared"
import { describe, expect, it } from "vitest"

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "supabase", "migrations")

const ECONOMICS = /(cost|usd|margin|markup|price|dollar)/i
const READER_NAMES = ["window", "report", "totals", "rows", "variance"] as const

const matches = readdirSync(MIGRATIONS_DIR).filter((f) => /_orgs_usage_reporting\.sql$/.test(f))

/** Strip `--` line and `/* *​/` block comments so a commented-out token never counts. */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "")
}

describe("369 usage-reporting migration guard", () => {
  it("is located by suffix exactly once (renumber-safe)", () => {
    expect(matches).toHaveLength(1)
  })

  const file = matches[0]
  const raw = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
  const sql = stripComments(raw)

  // Per-function bodies (comment-stripped), split on the CREATE line.
  const chunks = new Map<string, string>()
  for (const name of READER_NAMES) {
    const m = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION\\s+public\\.org_usage_${name}\\b[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`))
    if (m) chunks.set(name, m[1])
  }

  it("1. defines the five reader functions", () => {
    for (const name of READER_NAMES) {
      expect(sql, `org_usage_${name} present`).toMatch(
        new RegExp(`CREATE OR REPLACE FUNCTION\\s+public\\.org_usage_${name}\\s*\\(`),
      )
    }
  })

  it("2. no RETURNS TABLE column is economics-shaped", () => {
    const lists = [...sql.matchAll(/RETURNS TABLE\s*\(([\s\S]*?)\)\s*\n?\s*LANGUAGE/gi)].map((m) => m[1])
    expect(lists.length).toBe(5)
    for (const list of lists) {
      expect(ECONOMICS.test(list), `no cost/usd/price token in: ${list.trim()}`).toBe(false)
    }
  })

  it("3. cost_usd never occurs outside a comment", () => {
    expect(sql).not.toMatch(/cost_usd/i)
  })

  it("4. the three usage_logs readers filter status <> 'refunded'", () => {
    const hits = sql.match(/status\s*<>\s*'refunded'/g) ?? []
    expect(hits.length).toBeGreaterThanOrEqual(3)
  })

  it("5. the variance index is partial on source = 'org_usage_variance'", () => {
    const idx = sql.match(/CREATE INDEX[\s\S]*?idx_credit_tx_variance_org_created[\s\S]*?;/i)?.[0] ?? ""
    expect(idx).toMatch(/WHERE\s+source\s*=\s*'org_usage_variance'/i)
  })

  it("6. uses no CTE (the references guard would flag it)", () => {
    expect(sql).not.toMatch(/WITH\s+\w+\s+AS\s*\(/i)
  })

  it("7. org_usage_report carries the LIMIT 5001 truncation contract; totals does not", () => {
    expect(chunks.get("report") ?? "").toMatch(/\bLIMIT\s+5001\b/i)
    expect(chunks.get("totals") ?? "!!missing!!").not.toMatch(/\bLIMIT\b/i)
  })

  it("8. the SQL p_group_by NOT IN (...) list equals USAGE_GROUP_BYS minus none", () => {
    const clause = sql.match(/p_group_by\s+NOT IN\s*\(([^)]*)\)/i)?.[1] ?? ""
    const sqlList = [...clause.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
    const shared = USAGE_GROUP_BYS.filter((g) => g !== "none").slice().sort()
    expect(sqlList).toEqual(shared)
  })

  it("9. the RAISE-prefix set is exactly the five the plugin maps", () => {
    const prefixes = new Set([...sql.matchAll(/RAISE EXCEPTION\s+'([A-Z_]+):/g)].map((m) => m[1]))
    expect([...prefixes].sort()).toEqual(["BAD_CURSOR", "BAD_GROUP_BY", "BAD_SCOPE", "INVALID_TIMEZONE", "RANGE_TOO_LARGE"])
  })

  it("10. all five definers are STABLE", () => {
    expect((sql.match(/LANGUAGE plpgsql/g) ?? []).length).toBe(5)
    expect((sql.match(/LANGUAGE plpgsql STABLE/g) ?? []).length).toBe(5)
  })

  it("11. the three usage_logs readers carry #variable_conflict use_column (comment-stripped)", () => {
    // Counted on the comment-stripped source: a commented-out `-- #variable_conflict`
    // must not count. report + rows + totals read usage_logs; variance reads
    // credit_transactions fully alias-qualified and needs none.
    expect((sql.match(/#variable_conflict use_column/g) ?? []).length).toBe(3)
  })

  it("12. org_usage_totals aggregates the whole window (no GROUP BY, no LIMIT)", () => {
    const totals = chunks.get("totals") ?? "!!missing!!"
    expect(totals).not.toMatch(/GROUP BY/i)
    expect(totals).not.toMatch(/\bLIMIT\b/i)
  })

  it("13. org_usage_variance discriminates the two ledgers by 351/352's exact prefixes", () => {
    const variance = chunks.get("variance") ?? ""
    expect(variance).toMatch(/LIKE 'Metered overrun beyond workspace headroom%'/)
    expect(variance).toMatch(/LIKE 'App markup beyond workspace headroom%'/)
    // Pin the prefixes against the writers: a reworded 351/352 description must fail here.
    const m351 = readFileSync(join(MIGRATIONS_DIR, "351_orgs_billing.sql"), "utf8")
    const m352 = readFileSync(join(MIGRATIONS_DIR, "352_orgs_app_monetization_payer.sql"), "utf8")
    expect(m351, "351 still writes the metered-overrun prefix").toMatch(/'Metered overrun beyond workspace headroom/)
    expect(m352, "352 still writes the app-markup prefix").toMatch(/'App markup beyond workspace headroom/)
  })

  it("14. each org_usage_ function is defined in exactly one migration", () => {
    const allSql = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .map((f) => [f, readFileSync(join(MIGRATIONS_DIR, f), "utf8")] as const)
    for (const name of READER_NAMES) {
      const re = new RegExp(`CREATE OR REPLACE FUNCTION\\s+public\\.org_usage_${name}\\s*\\(`)
      const defs = allSql.filter(([, body]) => re.test(body)).map(([f]) => f)
      expect(defs, `org_usage_${name} defined in exactly one migration`).toHaveLength(1)
    }
  })

  it("15. all four data readers narrow by p_user_id (member self-view — P15R-01)", () => {
    // totals is narrowable by member; the variance line MUST be too, or a member
    // self-view subtracts the WHOLE workspace's absorbed overrun from ONE member's
    // settled total — chargedToBudget goes negative and leaks another member's
    // overrun. Both variance writers stamp the runner on the ledger row (351
    // v_user_id, 352 p_runner_id) so the narrowing is exact. window takes no scope.
    const DATA_READERS = ["report", "totals", "rows", "variance"] as const
    for (const name of DATA_READERS) {
      const paramList =
        sql.match(new RegExp(`CREATE OR REPLACE FUNCTION\\s+public\\.org_usage_${name}\\s*\\(([\\s\\S]*?)\\)\\s*RETURNS`, "i"))?.[1] ?? ""
      expect(paramList, `org_usage_${name} declares p_user_id UUID DEFAULT NULL`).toMatch(/p_user_id\s+UUID\s+DEFAULT\s+NULL/i)
      const body = chunks.get(name) ?? "!!missing!!"
      expect(body, `org_usage_${name} filters WHERE p_user_id IS NULL OR <alias>.user_id = p_user_id`).toMatch(
        /p_user_id IS NULL OR \w+\.user_id = p_user_id/,
      )
    }
  })
})

/**
 * L1#10 — Migration linter.
 *
 * Catches three classes of bug at PR time, before they hit production:
 *
 *   1. **Non-idempotent DDL** — `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE
 *      ADD COLUMN`, etc. without `IF NOT EXISTS`. A failed/partial migration
 *      followed by a retry then errors with "table already exists" instead
 *      of completing.
 *
 *   2. **Profiles RLS recursion footgun** — `CREATE POLICY ... ON profiles
 *      ... USING (... SELECT FROM profiles ...)` causes infinite recursion
 *      because the policy itself triggers profile reads. CLAUDE.md flags
 *      this as a hard rule. Use the `is_admin()` SECURITY DEFINER function
 *      instead.
 *
 *   3. **Non-idempotent model_pricing INSERTs** — every `INSERT INTO
 *      model_pricing` MUST end with `ON CONFLICT (model_identifier) DO
 *      NOTHING`. Without this, the migration fails on retry (after a partial
 *      run) and admins lose the ability to override pre-existing prices.
 *
 * Older migrations may legitimately violate these rules (predate the
 * convention) and are allowlisted explicitly. Going forward, any new
 * migration must comply or be added to the allowlist with a rationale.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"

const REPO_ROOT = join(__dirname, "..", "..", "..")
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase/migrations")

const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()

/**
 * Migrations that legitimately violate one of the linter rules. Each entry
 * MUST have a comment naming WHICH rule and WHY. Add new entries only when
 * compliance is genuinely impossible (almost never — IF NOT EXISTS is
 * additive in Postgres).
 */
const IDEMPOTENCY_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  // L1#10-allowlist: pre-existing migrations that pre-date the IF-NOT-EXISTS
  // convention. Each has already been applied to production DBs successfully;
  // adding IF [NOT] EXISTS would not change the runtime semantics. Going
  // forward (newer migration numbers), the linter enforces the convention.
  "001_initial_schema.sql",
  "002_add_role_column.sql",
  "004_characters_table.sql",
  "024_critical_security_fixes.sql",
  "025_medium_high_fixes.sql",
  "034_admin_stats_rpc_and_gallery_index.sql",
  "039_workflow_thumbnail.sql",
  "041_api_tokens.sql",
  "042_social_connections.sql",
  "044_published_apps.sql",
  "045_app_analytics.sql",
  "074_kie_credit_snapshots.sql",
  "078_model_execution_stats.sql",
  "083_app_monetization.sql",
  "091_node_defaults.sql",
  "093_developer_apps.sql",
  "094_mcp_dev_apps_kind.sql",
  "095_mcp_trigger_type.sql",
  "096_mcp_dynamic_tool_index.sql",
])

const PROFILES_RECURSION_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  // L1#10-allowlist: legacy migrations that had the profiles RLS recursion
  // pattern. Both have been REPLACED by migration 032_consolidate_rls_and_indexes,
  // which uses the is_admin() SECURITY DEFINER helper instead. The historical
  // policies in these files are no longer in effect — DROP POLICY in 032
  // removed them. Allowlisted because the SQL still appears in the
  // append-only migration history.
  "002_add_role_column.sql",
  "024_critical_security_fixes.sql",
])

const MODEL_PRICING_INSERT_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  // Add only when the migration intentionally uses ON CONFLICT DO UPDATE
  // (rare — typically for re-pricing after a documented sale).
])

/** Strip /* … *​/ comments and -- comments from SQL before scanning. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "") // /* block */
    .replace(/--[^\n]*/g, "")         // -- line
}

// ---------------------------------------------------------------------------
// Sanity check
// ---------------------------------------------------------------------------

describe("migration walk sanity", () => {
  it("found at least 50 migration files", () => {
    expect(MIGRATION_FILES.length).toBeGreaterThanOrEqual(50)
  })
})

// ---------------------------------------------------------------------------
// Test 1 — non-idempotent DDL.
// ---------------------------------------------------------------------------

describe("migrations are idempotent (DDL uses IF [NOT] EXISTS)", () => {
  it.each(MIGRATION_FILES)(
    "%s — CREATE TABLE / CREATE INDEX / CREATE TRIGGER / CREATE FUNCTION uses IF NOT EXISTS / OR REPLACE",
    (filename) => {
      if (IDEMPOTENCY_ALLOWLIST.has(filename)) return
      const sql = stripComments(readFileSync(join(MIGRATIONS_DIR, filename), "utf8"))

      // Each problematic statement on its own line.
      const violations: string[] = []

      // CREATE TABLE without IF NOT EXISTS
      for (const m of sql.matchAll(/\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)([^\s(]+)/gi)) {
        violations.push(`CREATE TABLE ${m[1]} → use "CREATE TABLE IF NOT EXISTS"`)
      }
      // CREATE INDEX without IF NOT EXISTS
      for (const m of sql.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS|CONCURRENTLY\s+IF\s+NOT\s+EXISTS)([^\s(]+)/gi)) {
        violations.push(`CREATE INDEX ${m[1]} → use "CREATE INDEX IF NOT EXISTS"`)
      }
      // CREATE TRIGGER without DROP IF EXISTS first OR OR REPLACE (Postgres
      // doesn't support OR REPLACE for triggers; the convention is
      // DROP TRIGGER IF EXISTS preceding).
      for (const m of sql.matchAll(/\bCREATE\s+TRIGGER\s+(\S+)/gi)) {
        const trgName = m[1]
        const dropPattern = new RegExp(
          `DROP\\s+TRIGGER\\s+IF\\s+EXISTS\\s+${trgName.replace(/[$()*+./?[\\\]^{|}-]/g, "\\$&")}\\b`,
          "i",
        )
        if (!dropPattern.test(sql)) {
          violations.push(`CREATE TRIGGER ${trgName} → precede with "DROP TRIGGER IF EXISTS ${trgName} ON …"`)
        }
      }
      // CREATE FUNCTION without OR REPLACE
      for (const m of sql.matchAll(/\bCREATE\s+(?!OR\s+REPLACE\s+)FUNCTION\s+(\S+)/gi)) {
        violations.push(`CREATE FUNCTION ${m[1]} → use "CREATE OR REPLACE FUNCTION"`)
      }
      // ALTER TABLE ADD COLUMN without IF NOT EXISTS
      for (const m of sql.matchAll(/\bALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)(\S+)/gi)) {
        violations.push(`ALTER TABLE … ADD COLUMN ${m[1]} → use "ADD COLUMN IF NOT EXISTS"`)
      }
      // ALTER TABLE DROP COLUMN without IF EXISTS
      for (const m of sql.matchAll(/\bALTER\s+TABLE\s+\S+\s+DROP\s+COLUMN\s+(?!IF\s+EXISTS)(\S+)/gi)) {
        violations.push(`ALTER TABLE … DROP COLUMN ${m[1]} → use "DROP COLUMN IF EXISTS"`)
      }

      expect(
        violations,
        `Migration ${filename} has non-idempotent DDL. Re-running this migration after a partial failure will error. Either fix the statements (preferred) or add "${filename}" to IDEMPOTENCY_ALLOWLIST in this test with a comment explaining why compliance is impossible.\n\n${violations.map((v) => `  • ${v}`).join("\n")}`,
      ).toEqual([])
    },
  )
})

// ---------------------------------------------------------------------------
// Test 2 — profiles RLS recursion footgun.
// ---------------------------------------------------------------------------

describe("migrations don't introduce profiles RLS recursion", () => {
  it.each(MIGRATION_FILES)(
    "%s — CREATE POLICY ON profiles does not query profiles inside USING/WITH CHECK",
    (filename) => {
      if (PROFILES_RECURSION_ALLOWLIST.has(filename)) return
      const sql = stripComments(readFileSync(join(MIGRATIONS_DIR, filename), "utf8"))

      // Find each CREATE POLICY ... ON profiles ... statement.
      const policyMatches = sql.matchAll(
        /CREATE\s+POLICY\s+[^;]+\s+ON\s+(?:public\.)?profiles[\s\S]+?;/gi,
      )

      const violations: string[] = []
      for (const m of policyMatches) {
        const stmt = m[0]
        // Look for `FROM profiles` or `JOIN profiles` inside this policy.
        // The is_admin() helper is OK (SECURITY DEFINER bypasses RLS).
        if (/\b(FROM|JOIN)\s+(?:public\.)?profiles\b/i.test(stmt)) {
          // Get a snippet for the error message
          const snippet = stmt.slice(0, 80).replace(/\s+/g, " ")
          violations.push(`Policy queries profiles: "${snippet}…"`)
        }
      }

      expect(
        violations,
        `Migration ${filename} creates a policy ON profiles that queries profiles in USING/WITH CHECK — INFINITE RECURSION risk. Use the is_admin() SECURITY DEFINER helper instead. CLAUDE.md flags this as a hard rule. If genuinely safe, add "${filename}" to PROFILES_RECURSION_ALLOWLIST with rationale.\n\n${violations.map((v) => `  • ${v}`).join("\n")}`,
      ).toEqual([])
    },
  )
})

// ---------------------------------------------------------------------------
// Test 3 — INSERT INTO model_pricing must use ON CONFLICT DO NOTHING.
// ---------------------------------------------------------------------------

describe("model_pricing INSERTs are idempotent", () => {
  it.each(MIGRATION_FILES)(
    "%s — every INSERT INTO model_pricing has ON CONFLICT DO NOTHING",
    (filename) => {
      if (MODEL_PRICING_INSERT_ALLOWLIST.has(filename)) return
      const sql = stripComments(readFileSync(join(MIGRATIONS_DIR, filename), "utf8"))

      // Match each INSERT INTO ...model_pricing... statement (case-insensitive).
      // Capture from `INSERT INTO ... model_pricing` to the next `;`.
      const inserts = sql.matchAll(
        /INSERT\s+INTO\s+(?:public\.)?model_pricing[\s\S]*?;/gi,
      )

      const violations: string[] = []
      for (const m of inserts) {
        const stmt = m[0]
        // Acceptable forms: ON CONFLICT (model_identifier) DO NOTHING
        //                   ON CONFLICT DO NOTHING
        //                   ON CONFLICT ... DO UPDATE  (intentional override)
        if (!/ON\s+CONFLICT[\s\S]+?DO\s+(NOTHING|UPDATE)/i.test(stmt)) {
          const snippet = stmt.slice(0, 90).replace(/\s+/g, " ")
          violations.push(`INSERT without ON CONFLICT: "${snippet}…"`)
        }
      }

      expect(
        violations,
        `Migration ${filename} has an INSERT INTO model_pricing without ON CONFLICT DO NOTHING (or DO UPDATE). On migration retry (or when the row was seeded by an earlier migration), this errors with "duplicate key violation" — admins lose the ability to override pre-seeded prices. Add "ON CONFLICT (model_identifier) DO NOTHING" before the trailing semicolon.\n\n${violations.map((v) => `  • ${v}`).join("\n")}`,
      ).toEqual([])
    },
  )
})

/**
 * Guards on the free-grant observation migration (PR 1 of the free-credit
 * abuse gate) — the invariants that are cheap to prove from the SQL text and
 * expensive to discover in production:
 *
 *   1. `profiles.free_grant_state` exists, defaults to 'unclaimed', and is
 *      CHECK-restricted to the three states the API contract can return.
 *   2. The backfill is PRESENT and BRACKETED. Every pre-existing profile
 *      already received its 1,500 via the column default, so without
 *      `SET free_grant_state = 'granted'` every dormant account double-grants
 *      the moment PR 2 turns enforcement on. And the bracket matters as much
 *      as the statement: `profiles` carries the `set_updated_at` trigger, so
 *      an unguarded bulk UPDATE stamps every row with the migration's own
 *      timestamp (migration-backfill-guards.test.ts owns that rule; this file
 *      pins the ordering so a later edit cannot move the UPDATE outside).
 *   3. `signup_signals` is service-role only: RLS on, ZERO policies. It holds
 *      hashes of things a user cannot change at will — a policy on it would be
 *      a read oracle over other people's devices.
 *   4. `claim_signup_grant` is revoked from PUBLIC, anon AND authenticated,
 *      with no grant back. Postgres grants EXECUTE to PUBLIC on a new function
 *      by default and PostgREST publishes public-schema functions at
 *      /rest/v1/rpc/, so an unlocked `claim_signup_grant(p_user_id, …)` is a
 *      self-serve credit mint for any logged-in user.
 *   5. The migration does NOT respell the `subscription_credits` column
 *      default. That flip is PR 2's, and free-tier-config.test.ts reads the
 *      RAW text of every migration for that statement — so even a COMMENT
 *      using the SQL spelling would make this file the "latest seed" and
 *      redden a test that has nothing to do with this change.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const REPO_ROOT = join(__dirname, "..", "..", "..")
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase/migrations")
const FILENAME = "365_signup_signals_free_grant_state.sql"

/** Raw text — what free-tier-config.test.ts and the BOM check read. */
const RAW = readFileSync(join(MIGRATIONS_DIR, FILENAME), "utf8").replace(/\r/g, "")
/** Comments blanked, line count preserved (the ordering checks index by line). */
const sql = RAW.replace(/--[^\n]*/g, "")
const lines = sql.split("\n")

/** The `CREATE TABLE … (` block for one table, up to the closing `\n);`. */
function tableBlock(table: string): string {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`)
  expect(start, `table ${table} not found`).toBeGreaterThanOrEqual(0)
  return sql.slice(start, sql.indexOf("\n);", start))
}

/** Body of `CREATE OR REPLACE FUNCTION public.<name>` up to its `$$;` close. */
function functionBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`)
  expect(start, `function ${name} not found`).toBeGreaterThanOrEqual(0)
  return sql.slice(start, sql.indexOf("$$;", start))
}

/** First index of the line matching `re`, or -1. */
function lineOf(re: RegExp): number {
  return lines.findIndex((l) => re.test(l))
}

describe("365 — profiles.free_grant_state", () => {
  it("adds the column with an 'unclaimed' default, idempotently", () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.profiles\s+ADD COLUMN IF NOT EXISTS free_grant_state text NOT NULL DEFAULT 'unclaimed'/i,
    )
  })

  it("restricts the column to exactly the three contract states", () => {
    const m = /CHECK \(free_grant_state IN \(([^)]+)\)\)/i.exec(sql)
    expect(m, "no CHECK list for free_grant_state").toBeTruthy()
    const values = [...m![1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]).sort()
    expect(values).toEqual(["granted", "unclaimed", "withheld"])
  })

  it("backfills every pre-existing profile to 'granted'", () => {
    // Without this, PR 2's enforcement re-grants 1,500 to every dormant
    // account that already spent its original grant.
    expect(sql).toMatch(/UPDATE public\.profiles\s+SET free_grant_state = 'granted';/i)
  })

  it("brackets the backfill so updated_at does not move", () => {
    const disable = lineOf(/ALTER TABLE (?:public\.)?profiles DISABLE TRIGGER set_updated_at/i)
    const update = lineOf(/UPDATE public\.profiles SET free_grant_state = 'granted'/i)
    const enable = lineOf(/ALTER TABLE (?:public\.)?profiles ENABLE TRIGGER set_updated_at/i)
    expect(disable, "no DISABLE TRIGGER set_updated_at").toBeGreaterThanOrEqual(0)
    expect(update, "the backfill must come after the DISABLE").toBeGreaterThan(disable)
    expect(enable, "the backfill must come before the ENABLE").toBeGreaterThan(update)
  })

  it("does not touch handle_new_user()", () => {
    expect(sql).not.toMatch(/handle_new_user/i)
  })
})

describe("365 — signup_signals is service-role only", () => {
  const createdTables = [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?(\w+)/g)].map((m) => m[1])

  it("creates exactly one table", () => {
    expect(createdTables).toEqual(["signup_signals"])
  })

  it("holds only hashes, cascade-deleted with the user", () => {
    const block = tableBlock("signup_signals")
    expect(block).toMatch(/id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/i)
    expect(block).toMatch(/user_id uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/i)
    expect(block).toMatch(/browser_key text/i)
    expect(block).toMatch(/device_key text/i)
    expect(block).toMatch(/ip_hash text NOT NULL/i)
    expect(block).toMatch(/source text NOT NULL DEFAULT 'claim'/i)
    expect(block).toMatch(/created_at timestamptz NOT NULL DEFAULT now\(\)/i)
  })

  it("is unique per (user_id, source) — the upsert-ignore target", () => {
    expect(tableBlock("signup_signals")).toMatch(/UNIQUE \(user_id, source\)/i)
  })

  it.each(["browser_key", "device_key", "ip_hash"])("indexes %s", (column) => {
    expect(sql).toMatch(
      new RegExp(`CREATE INDEX IF NOT EXISTS \\w+\\s+ON public\\.signup_signals\\s*\\(${column}\\)`, "i"),
    )
  })

  it("enables RLS", () => {
    expect(sql).toMatch(/ALTER TABLE public\.signup_signals\s+ENABLE ROW LEVEL SECURITY;/i)
  })

  it("creates ZERO policies — no client may read another person's signals", () => {
    const policies = [...sql.matchAll(/CREATE\s+POLICY[\s\S]*?;/gi)].map((m) => m[0])
    expect(policies).toEqual([])
  })

  it("revokes the table from anon and authenticated", () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.signup_signals FROM anon;/i)
    expect(sql).toMatch(/REVOKE ALL ON public\.signup_signals FROM authenticated;/i)
  })
})

describe("365 — claim_signup_grant", () => {
  it("is created idempotently with the pinned signature", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.claim_signup_grant\(p_user_id uuid, p_grant_amount integer\)/i,
    )
  })

  it("is SECURITY DEFINER with a pinned search_path", () => {
    const body = functionBody("claim_signup_grant")
    expect(body).toMatch(/SECURITY DEFINER/i)
    expect(body).toMatch(/SET search_path = public, pg_temp/i)
  })

  it("guards the transition and never lowers a balance", () => {
    const body = functionBody("claim_signup_grant")
    expect(body).toMatch(/SET free_grant_state = 'granted'/i)
    expect(body).toMatch(/subscription_credits = GREATEST\(p\.subscription_credits, p_grant_amount\)/i)
    expect(body).toMatch(/free_grant_state = 'unclaimed'/i)
  })

  it.each(["PUBLIC", "anon", "authenticated"])("is revoked from %s", (role) => {
    expect(sql).toMatch(
      new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.claim_signup_grant\\(uuid, integer\\) FROM ${role};`, "i"),
    )
  })

  it("is never granted back — a logged-in user must not be able to mint credits", () => {
    expect(sql).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.claim_signup_grant/i)
  })
})

describe("365 — credit_transactions.source admits the grant", () => {
  /** The CHECK list as one migration spells it. */
  function sourceValues(text: string): string[] {
    const m = /CHECK \(source IN \(([\s\S]*?)\)\)/i.exec(text.replace(/--[^\n]*/g, ""))
    expect(m, "no CHECK (source IN (…)) list").toBeTruthy()
    return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()
  }

  it("re-adds the FULL list plus 'signup_grant', losing nothing 351 admitted", () => {
    // 351's own comment: "adding values one at a time is how a CHECK ends up
    // describing half of what it admits". Derived from that file rather than
    // re-typed, so a value added there and forgotten here fails right away.
    const previous = sourceValues(readFileSync(join(MIGRATIONS_DIR, "351_orgs_billing.sql"), "utf8"))
    expect(sourceValues(RAW)).toEqual([...previous, "signup_grant"].sort())
  })
})

describe("365 — leaves PR 2's levers alone", () => {
  it("never spells an ALTER COLUMN subscription_credits SET DEFAULT — not even in a comment", () => {
    // free-tier-config.test.ts scans the RAW text of every migration, sorted,
    // and reads the LAST hit as the live signup default. A comment narrating
    // "PR 2 sets the default to 0" in SQL would make this file that hit.
    expect(RAW).not.toMatch(/ALTER\s+COLUMN\s+subscription_credits\s+SET\s+DEFAULT/i)
  })

  it("never re-seeds the free tier's daily cap — not even in a comment", () => {
    expect(RAW).not.toMatch(/daily_credit_limit\s*=\s*(?:NULL|\d+)\s+WHERE\s+tier\s*=\s*'free'/i)
  })
})

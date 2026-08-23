import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * A bulk UPDATE must not silently rewrite `updated_at` on every row it touches.
 *
 * Four tables carry the `set_updated_at` trigger from `001_initial_schema.sql`,
 * and its function does `NEW.updated_at = NOW()` UNCONDITIONALLY. So a backfill
 * written the obvious way —
 *
 *     UPDATE workflows SET created_by = user_id WHERE created_by IS NULL;
 *
 * — stamps every workflow in the database with the migration's own timestamp.
 * The dashboard sorts by that column, so every user's list loses its ordering
 * and reports everything as touched at the same instant. Nothing fails, no
 * error is logged, and the damage is not reversible: the original timestamps
 * are gone.
 *
 * This was found while writing `337_orgs_content_triggers.sql` and demonstrated
 * on the pinned Postgres image: unguarded, a workflow last edited in January
 * came back reporting the migration's timestamp; wrapped in DISABLE/ENABLE, the
 * timestamp survived and the backfill still happened.
 *
 * The rule this test enforces: a migration that UPDATEs one of those tables
 * either brackets the statement with `ALTER TABLE <t> DISABLE TRIGGER
 * set_updated_at` / `ENABLE`, or says on the line above why the timestamp
 * SHOULD move, with `-- updated-at-ok: <reason>`.
 *
 * Scoped to migrations numbered >= 332 — the same floor the reference check
 * uses. Retrofitting the rule onto applied history would prove nothing; the
 * point is that the next one gets it right by default.
 */

const MIGRATIONS_DIR = join(process.cwd(), "..", "supabase", "migrations")
const FLOOR = 332

/** The tables `001_initial_schema.sql` gives a `set_updated_at` trigger. */
const TIMESTAMPED_TABLES = ["profiles", "projects", "workflows", "subscriptions"] as const

const OK_MARKER = /--\s*updated-at-ok:\s*\S/

interface Offence {
  file: string
  line: number
  table: string
  statement: string
}

/**
 * Blank out line comments and single-quoted literals so neither can look like
 * SQL — WITHOUT changing the line count, because every index below is used to
 * read the original file.
 *
 * Two things this has to get right, both learned the hard way:
 *
 * 1. `\r`. Every migration in this repo is CRLF, so `split("\n")` leaves a
 *    trailing carriage return on each line. In JavaScript `.` does NOT match
 *    `\r` — it is a line terminator — so the obvious `l.replace(/--.*$/, "")`
 *    can never reach `$` and is a COMPLETE NO-OP on this repo's files. Every
 *    comment survived, their apostrophes ("today's", "caller's") were read as
 *    string quotes, and the resulting literals swallowed whole blocks: all six
 *    migrations came out 12 to 202 lines short.
 * 2. **Newlines must survive.** Replacing a multi-line literal with `''`
 *    deletes its newlines and shifts every index after it.
 *
 * So: strip `\r` first, blank each comment's TEXT in place, and blank a
 * literal's CONTENTS while keeping its newlines.
 */
function scrub(sql: string): string {
  return sql
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => {
      const at = l.indexOf("--")
      return at === -1 ? l : l.slice(0, at)
    })
    .join("\n")
    .replace(/'(?:[^']|'')*'/g, (m) => "'" + m.slice(1, -1).replace(/[^\n]/g, " ") + "'")
}

/**
 * Exported so the acceptance tests below run the same code path the per-file
 * checks do, rather than a re-implementation of it that could agree with a bug.
 */
export function unguardedBackfills(sql: string, file: string): Offence[] {
  const lines = sql.split("\n")
  const text = scrub(sql)
  const scrubbed = text.split("\n")
  const found: Offence[] = []

  for (const table of TIMESTAMPED_TABLES) {
    // The guard must ENCLOSE the statement, not merely appear in the file. A
    // DISABLE at the bottom, after an unguarded UPDATE at the top, is not a
    // guard — and "the file mentions it somewhere" is the kind of rule that
    // reads like coverage and provides none.
    const spans = guardSpans(scrubbed, table)

    // Matched over the WHOLE text, not line by line, because `\s` has to be
    // allowed to cross a newline: "UPDATE workflows" on one line and "SET …"
    // on the next is ordinary SQL formatting, and a rule that fires only on
    // the one-line spelling lets the author's line breaks decide whether it
    // fires at all. `\b` rather than `^\s*` for the same reason — a
    // statement need not start its own line either.
    const updatePattern = new RegExp(`\\bUPDATE\\s+(?:public\\.)?${table}\\s+SET\\b`, "gi")
    let hit: RegExpExecArray | null
    while ((hit = updatePattern.exec(text)) !== null) {
      // scrub() preserves the line count, so an index into the scrubbed text
      // maps onto the original file's lines.
      const i = text.slice(0, hit.index).split("\n").length - 1
      // An UPDATE inside a function body is runtime behaviour, not a backfill;
      // the rule is about statements the migration itself executes.
      if (insideFunctionBody(scrubbed, i)) continue
      if (spans.some(([from, to]) => i > from && i < to)) continue
      // Explicit opt-out on the statement or the line above it.
      if (OK_MARKER.test(lines[i]) || (i > 0 && OK_MARKER.test(lines[i - 1]))) continue
      found.push({ file, line: i + 1, table, statement: lines[i].trim() })
    }
  }
  return found
}

/**
 * Line ranges over which `set_updated_at` is disabled for this table, as
 * [disableLine, enableLine] pairs. An unmatched DISABLE runs to end of file —
 * the trigger really is off from there on, whether or not that was intended.
 */
function guardSpans(lines: readonly string[], table: string): Array<[number, number]> {
  const disable = new RegExp(`ALTER\\s+TABLE\\s+(?:public\\.)?${table}\\s+DISABLE\\s+TRIGGER\\s+set_updated_at`, "i")
  const enable = new RegExp(`ALTER\\s+TABLE\\s+(?:public\\.)?${table}\\s+ENABLE\\s+TRIGGER\\s+set_updated_at`, "i")
  const spans: Array<[number, number]> = []
  let open: number | null = null
  for (let i = 0; i < lines.length; i += 1) {
    if (open === null && disable.test(lines[i])) open = i
    else if (open !== null && enable.test(lines[i])) {
      spans.push([open, i])
      open = null
    }
  }
  if (open !== null) spans.push([open, lines.length])
  return spans
}

/**
 * Is this line inside a dollar-quoted body?
 *
 * Any tag, not just the bare `$$`: Postgres allows `$fn$ … $fn$`, and a body
 * opened with a tag this function did not recognise would leave every UPDATE
 * inside it looking like a top-level backfill. No migration uses a tagged
 * quote today, but the next planned one does, so the false positive would have
 * arrived before anyone thought to look for it. A body closes only on its OWN
 * tag, which is the whole reason tags exist.
 */
function insideFunctionBody(lines: readonly string[], index: number): boolean {
  let openTag: string | null = null
  for (let i = 0; i < index; i += 1) {
    for (const [tag] of lines[i].matchAll(/\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$/g)) {
      if (openTag === null) openTag = tag
      else if (tag === openTag) openTag = null
    }
  }
  return openTag !== null
}

const orgMigrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .filter((f) => Number.parseInt(f.slice(0, 3), 10) >= FLOOR)
  .sort()

describe("migrations — a bulk UPDATE never silently rewrites updated_at", () => {
  it("has migrations in scope", () => {
    expect(orgMigrations.length).toBeGreaterThan(0)
  })

  it.each(orgMigrations.map((f) => [f] as const))("%s", (file) => {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
    const offences = unguardedBackfills(sql, file)
    expect(
      offences.map(
        (o) =>
          `${o.file}:${o.line} updates ${o.table} without disabling set_updated_at — ` +
          `wrap it in ALTER TABLE ${o.table} DISABLE/ENABLE TRIGGER set_updated_at, or write ` +
          `\`-- updated-at-ok: <why the timestamp should move>\` above it. Statement: ${o.statement}`,
      ),
    ).toEqual([])
  })

  // The assertion that would have caught the CRLF no-op above. Every index in
  // unguardedBackfills reads the ORIGINAL file, so a scrub that changes the
  // line count silently points the opt-out check and the reported line number
  // at the wrong line.
  it.each(orgMigrations.map((f) => [f] as const))("%s — scrubbing preserves the line count", (file) => {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
    expect(scrub(sql).split("\n").length).toBe(sql.replace(/\r/g, "").split("\n").length)
  })

  it("actually removes comments — on CRLF files, which is all of them", () => {
    const sql = "-- UPDATE workflows SET created_by = user_id;\r\nSELECT 1;\r\n"
    expect(scrub(sql)).not.toContain("UPDATE")
  })

  it("blanks a multi-line string literal without eating its newlines", () => {
    const sql = "SELECT 'a\nb\nc';\nUPDATE workflows SET created_by = user_id;\n"
    const out = scrub(sql)
    // The line count is what every index in unguardedBackfills depends on.
    expect(out.split("\n").length).toBe(sql.split("\n").length)
    // The literal is blanked IN PLACE: its middle line is now whitespace.
    expect(out.split("\n")[1].trim()).toBe("")
    // And the UPDATE after it is still reported at its real line.
    expect(unguardedBackfills(sql, "probe.sql")[0]?.line).toBe(4)
  })

  it("catches a backfill split across lines — the author's formatting is not the rule", () => {
    const sql = "UPDATE workflows\n   SET created_by = user_id\n WHERE created_by IS NULL;\n"
    const offences = unguardedBackfills(sql, "probe.sql")
    expect(offences).toHaveLength(1)
    expect(offences[0].line).toBe(1)
  })

  it("does not fire on an UPDATE inside a TAGGED dollar-quoted body", () => {
    const sql = [
      "CREATE OR REPLACE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $fn$",
      "BEGIN",
      "  UPDATE workflows SET workspace_id = NEW.workspace_id WHERE project_id = NEW.id;",
      "  RETURN NEW;",
      "END $fn$;",
    ].join("\n")
    expect(unguardedBackfills(sql, "probe.sql")).toEqual([])
  })

  it("catches an unguarded backfill", () => {
    const offences = unguardedBackfills(
      "UPDATE workflows SET created_by = user_id WHERE created_by IS NULL;\n",
      "probe.sql",
    )
    expect(offences).toHaveLength(1)
    expect(offences[0].table).toBe("workflows")
  })

  it("accepts one wrapped in DISABLE/ENABLE", () => {
    const sql = [
      "ALTER TABLE workflows DISABLE TRIGGER set_updated_at;",
      "UPDATE workflows SET created_by = user_id WHERE created_by IS NULL;",
      "ALTER TABLE workflows ENABLE TRIGGER set_updated_at;",
    ].join("\n")
    expect(unguardedBackfills(sql, "probe.sql")).toEqual([])
  })

  it("rejects a guard that does not enclose the statement", () => {
    const sql = [
      "UPDATE workflows SET created_by = user_id WHERE created_by IS NULL;",
      "ALTER TABLE workflows DISABLE TRIGGER set_updated_at;",
      "UPDATE workflows SET source_kind = 'x' WHERE source_kind IS NULL;",
      "ALTER TABLE workflows ENABLE TRIGGER set_updated_at;",
    ].join("\n")
    const offences = unguardedBackfills(sql, "probe.sql")
    expect(offences).toHaveLength(1)
    expect(offences[0].line).toBe(1)
  })

  it("accepts one that says why the timestamp should move", () => {
    const sql = [
      "-- updated-at-ok: renaming is a real edit and should surface as recent",
      "UPDATE projects SET name = 'x' WHERE id = '00000000-0000-0000-0000-000000000000';",
    ].join("\n")
    expect(unguardedBackfills(sql, "probe.sql")).toEqual([])
  })

  it("does not fire on an UPDATE inside a trigger function body", () => {
    const sql = [
      "CREATE OR REPLACE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$",
      "BEGIN",
      "  UPDATE workflows SET workspace_id = NEW.workspace_id WHERE project_id = NEW.id;",
      "  RETURN NEW;",
      "END $$;",
    ].join("\n")
    expect(unguardedBackfills(sql, "probe.sql")).toEqual([])
  })

  it("is not fooled by an UPDATE that only appears inside a comment or a string", () => {
    const sql = [
      "-- UPDATE workflows SET created_by = user_id;",
      "SELECT 'UPDATE workflows SET created_by = user_id';",
    ].join("\n")
    expect(unguardedBackfills(sql, "probe.sql")).toEqual([])
  })
})

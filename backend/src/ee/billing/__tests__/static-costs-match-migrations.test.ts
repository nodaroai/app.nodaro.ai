// @test-watches supabase/migrations/*.sql
/**
 * STATIC_CREDIT_COSTS HOLDS WHAT THE MIGRATIONS SEED.
 *
 * `model_pricing` is the price a run is charged; `STATIC_CREDIT_COSTS` is what
 * every surface that cannot read the database prices from — the editor's
 * estimates, the public docs, the MCP tool descriptions, the generated skills,
 * and the fallback when the table read fails. The two used to be kept equal
 * by hand, and drifted: a 2026-09-06 regeneration of the video-analysis and
 * video-audit buckets moved 28 static rows up by 1–5 credits with no
 * migration, so for five weeks every one of those surfaces quoted a price no
 * run was charged.
 *
 * This suite replays `supabase/migrations/` in order — an insert seeds a row
 * that is absent (or overwrites it under `DO UPDATE SET credit_cost =
 * EXCLUDED.credit_cost`), an update or delete acts on the rows it names — and
 * holds every static id to the value the LAST migration that touched it left.
 * A reprice therefore ships as a migration AND the static row together, or
 * not at all. (An admin may still price a row differently at runtime; the
 * docs track that in `docs-price-settings.json`'s `charged` snapshot.)
 *
 * A statement the replay cannot read exactly (a derived `UPDATE … FROM`, an
 * `INSERT … SELECT`, a value that is an expression) makes the ids it reaches
 * UNKNOWN, and an unknown id is never compared. That set is pinned below, so
 * a new SQL shape fails here, loudly, instead of quietly shrinking coverage.
 */
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { STATIC_CREDIT_COSTS } from "../credits.js"

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations")

type Value = number | "unknown"

/** Splits SQL into statements on `;`, outside quotes, comments and `$…$` bodies. */
function splitStatements(sql: string): string[] {
  const out: string[] = []
  let cur = ""
  let quoted = false
  let dollar: string | null = null
  for (let i = 0; i < sql.length; ) {
    const ch = sql[i]!
    if (!quoted && !dollar && ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i)
      i = nl < 0 ? sql.length : nl
      continue
    }
    if (!quoted && !dollar && ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2)
      i = end < 0 ? sql.length : end + 2
      continue
    }
    if (!quoted) {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 64))
      if (tag) {
        if (dollar === null) dollar = tag[0]
        else if (dollar === tag[0]) dollar = null
        cur += tag[0]
        i += tag[0].length
        continue
      }
    }
    if (!dollar && ch === "'") quoted = !quoted
    if (!quoted && !dollar && ch === ";") {
      if (cur.trim()) out.push(cur.trim())
      cur = ""
      i++
      continue
    }
    cur += ch
    i++
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** The top-level `( … )` tuples of a VALUES list, each split into its values. */
function tuples(values: string): string[][] {
  const out: string[][] = []
  let depth = 0
  let quoted = false
  let cur = ""
  let row: string[] = []
  for (const ch of values) {
    if (ch === "'") quoted = !quoted
    if (!quoted && ch === "(") {
      depth++
      if (depth === 1) {
        cur = ""
        row = []
        continue
      }
    }
    if (!quoted && ch === ")") {
      depth--
      if (depth === 0) {
        row.push(cur.trim())
        out.push(row)
        continue
      }
    }
    if (depth >= 1) {
      if (!quoted && depth === 1 && ch === ",") {
        row.push(cur.trim())
        cur = ""
        continue
      }
      cur += ch
    }
  }
  return out
}

const numberOf = (v: string): Value => (/^-?\d+(?:\.\d+)?$/.test(v) ? Number(v) : "unknown")
const stringOf = (v: string): string | null => /^'(.*)'$/s.exec(v)?.[1] ?? null
const likeToRegExp = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`)

/** `model_identifier = 'x'` or `model_identifier IN ('x', …)`, else null. */
function namedIds(where: string): string[] | null {
  const eq = /^\s*model_identifier\s*=\s*'([^']+)'\s*$/is.exec(where)
  if (eq) return [eq[1]!]
  const list = /^\s*model_identifier\s+IN\s*\(([^)]*)\)\s*$/is.exec(where)
  if (list) return [...list[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
  return null
}

/** The final `model_pricing` value of every id the migrations leave, in migration order. */
function replayModelPricing(files: { name: string; sql: string }[]): Map<string, Value> {
  const rows = new Map<string, Value>()
  /** Every existing id a statement could reach: named literally, by a quoted LIKE pattern, or by `~ 'regex'`. */
  const reached = (st: string) => {
    const quoted = [...st.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
    const regexes = [...st.matchAll(/~\s*'([^']+)'/g)].map((m) => new RegExp(m[1]!))
    return [...rows.keys()].filter(
      (id) =>
        quoted.includes(id) ||
        quoted.some((q) => q.includes("%") && likeToRegExp(q).test(id)) ||
        regexes.some((r) => r.test(id)),
    )
  }
  for (const { sql } of files) {
    for (const st of splitStatements(sql)) {
      if (!/model_pricing/i.test(st)) continue
      const insert = /^INSERT\s+INTO\s+(?:public\.)?model_pricing\s*\(([^)]*)\)\s*VALUES([\s\S]*?)(ON\s+CONFLICT[\s\S]*)?$/i.exec(st)
      if (insert) {
        const cols = insert[1]!.split(",").map((c) => c.trim().toLowerCase())
        const idAt = cols.indexOf("model_identifier")
        const costAt = cols.indexOf("credit_cost")
        const conflict = insert[3] ?? ""
        const overwrites = /DO\s+UPDATE/i.test(conflict) && /credit_cost\s*=\s*EXCLUDED\.credit_cost/i.test(conflict)
        const setsOther = /DO\s+UPDATE/i.test(conflict) && !overwrites && /credit_cost\s*=/i.test(conflict)
        for (const row of tuples(insert[2]!)) {
          const id = stringOf(row[idAt] ?? "")
          if (!id) continue
          const value = costAt >= 0 ? numberOf(row[costAt] ?? "") : "unknown"
          if (!rows.has(id) || !conflict || overwrites) rows.set(id, value)
          else if (setsOther) rows.set(id, "unknown")
        }
        continue
      }
      const update = /^UPDATE\s+(?:public\.)?model_pricing(?:\s+(?:AS\s+)?\w+)?\s+SET\s+([\s\S]*?)(?:\s+WHERE\s+([\s\S]*))?$/i.exec(st)
      if (update) {
        const cost = /credit_cost\s*=\s*([^,]+?)\s*(?:,|$)/i.exec(update[1]!)
        if (!cost) continue
        const value = numberOf(cost[1]!.trim())
        const where = update[2] ?? ""
        const named = namedIds(where)
        if (named) {
          for (const id of named) if (rows.has(id)) rows.set(id, value)
          continue
        }
        // A guarded reprice: `… AND credit_cost = <old>` moves the row only from that value
        // (`<>` sets it wherever it is not already the new one — the same as setting it).
        const guarded = /^\s*model_identifier\s*=\s*'([^']+)'\s+AND\s+credit_cost\s*(=|<>)\s*(\d+)\s*$/is.exec(where)
        if (guarded) {
          const [, id, op, from] = guarded
          const current = rows.get(id!)
          if (current === undefined) continue
          if (op === "<>" || current === Number(from)) rows.set(id!, value)
          else if (current === "unknown") rows.set(id!, "unknown")
          continue
        }
        const like = /^\s*model_identifier\s+I?LIKE\s+'([^']+)'\s*$/is.exec(where)
        const targets = like ? [...rows.keys()].filter((id) => likeToRegExp(like[1]!).test(id)) : where === "" ? [...rows.keys()] : reached(st)
        for (const id of targets) rows.set(id, like ? value : "unknown")
        continue
      }
      const del = /^DELETE\s+FROM\s+(?:public\.)?model_pricing(?:\s+WHERE\s+([\s\S]*))?$/i.exec(st)
      if (del) {
        const named = namedIds(del[1] ?? "")
        for (const id of named ?? reached(st)) rows.delete(id)
        continue
      }
      // DDL, grants and policies change no price; anything else that names rows makes them unknown.
      if (/^(?:SELECT|COMMENT|CREATE\s+(?:UNIQUE\s+)?INDEX|CREATE\s+TABLE|ALTER|GRANT|REVOKE|DROP|BEGIN|COMMIT)\b/i.test(st)) continue
      for (const id of reached(st)) rows.set(id, "unknown")
    }
  }
  return rows
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b))
  .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8") }))
const seeded = replayModelPricing(files)

/**
 * Ids no migration states as a number: migration 490 derives every
 * `:premium-direct` LLM rung from its `:premium` row in SQL
 * (`CEIL(premium.credit_cost * 2.5)`), so the replay cannot know them.
 */
const DERIVED_IN_SQL = /:premium-direct$/

describe("STATIC_CREDIT_COSTS equals the latest migration-seeded model_pricing value", () => {
  it("every id a migration seeds with a number carries that number in STATIC_CREDIT_COSTS", () => {
    const drift: string[] = []
    let compared = 0
    for (const [id, value] of seeded) {
      const row = STATIC_CREDIT_COSTS[id]
      if (value === "unknown" || typeof row !== "number") continue
      compared++
      if (row !== value) drift.push(`${id}: STATIC_CREDIT_COSTS ${row}, latest migration ${value}`)
    }
    expect(drift, "a reprice ships the migration and the static row together").toEqual([])
    // The replay reads (nearly) the whole table; a parser that silently stopped matching would compare nothing.
    expect(compared).toBeGreaterThan(1500)
  })

  it("the ids the replay cannot read are exactly the SQL-derived rungs", () => {
    const unknown = [...seeded].filter(([, v]) => v === "unknown").map(([id]) => id)
    expect(unknown.filter((id) => !DERIVED_IN_SQL.test(id)), "a new SQL shape the replay cannot read — teach it, do not skip").toEqual([])
    expect(unknown.length).toBeGreaterThan(0)
  })

  it("the replay applies inserts, conflicts, updates and deletes in order", () => {
    const sql = [
      "INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('a', 1), ('b', 2) ON CONFLICT DO NOTHING;",
      "INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('a', 9) ON CONFLICT (model_identifier) DO NOTHING;",
      "INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled) VALUES ('b', 3, true) ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;",
      "UPDATE model_pricing SET credit_cost = 5 WHERE model_identifier = 'a';",
      "UPDATE model_pricing SET credit_cost = 7 WHERE model_identifier = 'absent';",
      "UPDATE model_pricing SET credit_cost = 8 WHERE model_identifier = 'b' AND credit_cost = 2;",
      "INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('e', 10);",
      "UPDATE model_pricing SET credit_cost = 20 WHERE model_identifier = 'e' AND credit_cost = 10;",
      "INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('c:1', 4), ('c:2', 4);",
      "DELETE FROM model_pricing WHERE model_identifier LIKE 'c:%';",
      "INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('d', 6); -- a comment; with a semicolon",
      "UPDATE model_pricing AS x SET credit_cost = CEIL(y.credit_cost * 2)::int FROM model_pricing AS y WHERE x.model_identifier IN ('d');",
    ].join("\n")
    const out = replayModelPricing([{ name: "001_x.sql", sql }])
    expect(Object.fromEntries(out)).toEqual({ a: 5, b: 3, d: "unknown", e: 20 })
  })
})

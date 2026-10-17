// @test-watches backend/src/**/*.ts supabase/migrations/*.sql
/**
 * Every `jobs` column the backend names exists.
 *
 * The backend's Supabase client is untyped (`createClient` with no `Database`
 * generic, lib/supabase.ts), so a write, filter or select naming a column the
 * table does not have compiles — and fails only at run time, where PostgREST
 * rejects the WHOLE request: an UPDATE that sets `error` is not applied at all
 * (the row never flips to failed), an UPDATE whose `.select(...)` names a
 * missing column is rolled back, and a read that names one returns no rows.
 * Callers that discard the `{ error }` never notice. The frontend's generated
 * types (frontend/src/types/database.types.ts) are stale, so regenerating
 * types is not the guard either.
 *
 * So the column set is read from the migrations — the one source of truth for
 * the schema — and every literal a `.from("jobs")` chain or an `insertJob*`
 * call names is checked against it: write keys, filter columns, select lists.
 * A write whose payload is not a literal is listed below with the reason it is
 * safe; a new one fails until it is listed.
 */
import { describe, it, expect } from "vitest"
import ts from "typescript"
import { SCAN_TIMEOUT_MS, eachSourceFile, lineOf, walk } from "./source-scan.js"
import { columnOf, jobsColumns, selectColumns } from "./jobs-schema.js"

const COLUMNS = jobsColumns()

/**
 * Writes whose payload is not an object literal, so their keys are checked
 * where the payload is built. Each entry is `file → count`; a new site fails
 * until it is listed here with its reason.
 */
const NON_LITERAL_WRITES: Record<string, { count: number; why: string }> = {
  // insertJob / insertJobs / insertJobIdempotent: the payload is the caller's,
  // and every caller's literal is checked below (the `insertJob*` calls).
  "lib/insert-job.ts": { count: 3, why: "the insert funnel — its callers' literals are checked" },
  // markJobFailed: fixed keys plus `extra`, which the result gate fills from a
  // completion payload (checked at markJobCompleted's callers' literals).
  "lib/job-failure.ts": { count: 1, why: "the failure funnel — fixed columns plus the caller's `extra`" },
  "lib/job-policy-review.ts": { count: 1, why: "spreads a held completion payload that was a checked literal when it was held" },
  "workers/shared.ts": { count: 1, why: "markJobCompleted — its callers' completion literals" },
  "middleware/credit-guard.ts": { count: 1, why: "writes back fields read from the same row" },
  "routes/component-execute.ts": { count: 1, why: "spreads a literal built in the same function" },
}

const WRITE_METHODS = new Set(["update", "insert", "upsert"])
const FILTER_METHODS = new Set(["eq", "neq", "in", "is", "gt", "gte", "lt", "lte", "like", "ilike", "contains", "containedBy", "not", "filter", "order"])
/** The insert funnels, each with the index of the row (or rows) it writes. */
const INSERT_FUNNELS: Record<string, number> = { insertJob: 1, insertJobs: 1, insertJobIdempotent: 1, insertSyncJob: 1, insertInternalJob: 1 }

/**
 * Column helpers a write spreads (`...completedJobColumns()`): every function
 * whose body is one `return { … }` of literal keys, by name — read from the
 * source, so a helper that grows a key is checked with it.
 */
/** The failure funnel: its `extra` lands on the row as columns. */
const FAILURE_FUNNELS = new Set(["markJobFailed", "markJobFailedDetailed"])

const COLUMN_HELPERS = new Map<string, string[]>()
function readColumnHelpers(): void {
  if (COLUMN_HELPERS.size > 0) return
  eachSourceFile(["return {"], (sf) => {
    walk(sf, (n) => {
      if (!ts.isFunctionDeclaration(n) || !n.name || !n.body || n.body.statements.length !== 1) return
      const only = n.body.statements[0]!
      if (!ts.isReturnStatement(only) || !only.expression) return
      const keys = literalKeys(only.expression)
      if (keys) COLUMN_HELPERS.set(n.name.text, keys)
    })
  })
}

/** The literal keys an object (or array of objects) names; `null` when it is not a literal. */
function literalKeys(node: ts.Expression | undefined): string[] | null {
  if (!node) return null
  let e = node
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && COLUMN_HELPERS.has(e.expression.text)) {
    return [...COLUMN_HELPERS.get(e.expression.text)!]
  }
  if (ts.isArrayLiteralExpression(e)) {
    const all: string[] = []
    for (const el of e.elements) {
      const k = literalKeys(el as ts.Expression)
      if (k === null) return null
      all.push(...k)
    }
    return all
  }
  if (!ts.isObjectLiteralExpression(e)) return null
  const keys: string[] = []
  for (const p of e.properties) {
    if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
      keys.push(p.name.text)
    } else if (ts.isSpreadAssignment(p)) {
      let s = p.expression
      while (ts.isParenthesizedExpression(s)) s = s.expression
      // `cond ? {a} : {}` and `cond && {a}` name their literals; `x ?? {}` / `x || {}` spread `x`, unknown.
      const branches = ts.isConditionalExpression(s)
        ? [s.whenTrue, s.whenFalse]
        : ts.isBinaryExpression(s) && s.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
          ? [s.right]
          : ts.isBinaryExpression(s)
            ? [s.left, s.right]
            : [s]
      for (const b of branches) {
        const k = literalKeys(b)
        if (k === null) return null
        keys.push(...k)
      }
    }
  }
  return keys
}

/** Is `call`'s receiver chain rooted at `.from("jobs")`? */
function onJobs(call: ts.CallExpression): boolean {
  let r: ts.Expression = (call.expression as ts.PropertyAccessExpression).expression
  for (;;) {
    if (ts.isCallExpression(r) && ts.isPropertyAccessExpression(r.expression)) {
      if (r.expression.name.text === "from") {
        const a = r.arguments[0]
        return !!a && ts.isStringLiteralLike(a) && a.text === "jobs"
      }
      r = r.expression.expression
    } else if (ts.isPropertyAccessExpression(r) || ts.isNonNullExpression(r) || ts.isParenthesizedExpression(r)) {
      r = r.expression
    } else if (ts.isAwaitExpression(r)) {
      r = r.expression
    } else {
      return false
    }
  }
}

interface Finding { where: string; what: string }

interface Census { readonly unknown: readonly Finding[]; readonly nonLiteral: Readonly<Record<string, number>> }

/**
 * The census, taken once per run: both tests below read it, and each used to
 * parse every file that names the jobs table again. (The column-helper read
 * above is already once per run, and is the bulk of the parse.)
 */
let census: Census | undefined
function scan(): Census {
  return (census ??= takeCensus())
}

function takeCensus(): Census {
  const unknown: Finding[] = []
  const nonLiteral: Record<string, number> = {}
  readColumnHelpers()
  eachSourceFile(['"jobs"', "'jobs'", "insertJob", "insertSyncJob", "insertInternalJob", "markJobFailed"], (sf, rel) => {
    walk(sf, (n) => {
      if (!ts.isCallExpression(n)) return
      const where = `${rel}:${lineOf(sf, n)}`
      const check = (cols: string[], what: string) => {
        for (const c of cols) if (!COLUMNS.has(c)) unknown.push({ where, what: `${what} ${c}` })
      }
      if (ts.isIdentifier(n.expression) && Object.hasOwn(INSERT_FUNNELS, n.expression.text)) {
        const keys = literalKeys(n.arguments[INSERT_FUNNELS[n.expression.text]!])
        if (keys) check(keys, `${n.expression.text} key`)
        return
      }
      // markJobFailed's own fields are fixed; its `extra` is written as columns.
      if (ts.isIdentifier(n.expression) && FAILURE_FUNNELS.has(n.expression.text)) {
        const input = n.arguments[1]
        const extra = input && ts.isObjectLiteralExpression(input)
          ? input.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "extra")
          : undefined
        const keys = extra ? literalKeys(extra.initializer) : null
        if (keys) check(keys, `${n.expression.text} extra key`)
        return
      }
      if (!ts.isPropertyAccessExpression(n.expression) || !onJobs(n)) return
      const method = n.expression.name.text
      const arg = n.arguments[0]
      if (WRITE_METHODS.has(method)) {
        const keys = literalKeys(arg)
        if (keys === null) nonLiteral[rel] = (nonLiteral[rel] ?? 0) + 1
        else check(keys, `${method} key`)
      } else if (FILTER_METHODS.has(method) && arg && ts.isStringLiteralLike(arg)) {
        check([columnOf(arg.text)], `${method} column`)
      } else if (method === "select" && arg && ts.isStringLiteralLike(arg)) {
        check(selectColumns(arg.text), "select column")
      }
    })
  })
  return { unknown, nonLiteral }
}

describe("the jobs columns census", () => {
  it("reads the schema the migrations build", () => {
    for (const col of ["id", "status", "error_message", "error_detail", "provider_task_id", "job_type", "output_data", "credits"]) {
      expect(COLUMNS.has(col), col).toBe(true)
    }
    // Dropped (063), renamed away (063), or never created (303 says so).
    for (const col of ["credits_used", "credits_estimated", "updated_at", "error", "metadata", "model_identifier"]) {
      expect(COLUMNS.has(col), col).toBe(false)
    }
  })

  it("reads a select list's own columns, not an embedded resource's", () => {
    expect(selectColumns("id, user_id, profiles!user_id(tier, subscription_tier), metadata->>x, a:status, credits::text")).toEqual(["id", "user_id", "metadata", "status", "credits"])
  })

  it("every jobs column the backend names exists", () => {
    const { unknown } = scan()
    expect(unknown.map((f) => `${f.where} ${f.what}`)).toEqual([])
  }, SCAN_TIMEOUT_MS)

  it("every non-literal jobs write is one of the reviewed funnels", () => {
    const { nonLiteral } = scan()
    expect(nonLiteral).toEqual(Object.fromEntries(Object.entries(NON_LITERAL_WRITES).map(([f, { count }]) => [f, count])))
  }, SCAN_TIMEOUT_MS)
})

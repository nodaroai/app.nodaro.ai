// @test-watches backend/src/**/*.ts
/**
 * Every row inserted into `workflow_executions` names its lane (`trigger_type`) in place.
 *
 * `trigger_type` has a column default, and the default is one of the lanes whose
 * `trigger_data` stamps `serverStamps` reads as the platform's own
 * (lib/server-started-runs.ts). An insert that names no lane takes the default,
 * and its `trigger_data` would then be read as a stamp. So:
 *
 * 1. every insert or upsert row names `trigger_type` once, as an unconditional
 *    top-level property that no spread in the row sets again, and the guard
 *    sees the whole row where it is written —
 *    an object literal, an array of them, a `.map` callback's literal, an
 *    in-scope `const`, and spreads of those. A row or a spread it cannot see
 *    into (a parameter, an import, another call's result) fails; a column
 *    builder (`COLUMN_BUILDERS`) is allowed because its output is checked below;
 * 2. `trigger_type` is written nowhere else: no update, no other object, no
 *    member assignment or `delete` — a run's lane is set once, at its insert;
 * 3. the table name appears only where the guard follows it: as `.from(…)`'s
 *    table with the call on it, or as an insert helper's table. A table-name
 *    const, a wrapper that takes a table, or a builder held apart from its call
 *    would hide a write, so each one fails until it is listed;
 * 4. an insert on a stamp-writing lane (or on a lane the source does not spell
 *    out) stores in `trigger_data` only what a platform stamp builder made;
 * 5. the inserts are listed (`INSERTS`): a new lane fails until it is added.
 *
 * `trigger_data` writes in any shape are classified by `trigger-data-stamps.test.ts`.
 * A direct update's row must be visible the same way (a spread of caller data
 * would carry either key unseen); a helper that forwards its callers' rows is
 * listed in `UPDATE_ROWS_FROM_CALLERS`. Rows that reach the table through such a
 * helper are not shape-checked here: rule 2 and that guard see a key only
 * where the source spells it out.
 *
 * Every finding names the change to make, or the list to add it to when the
 * code is right (`NOT_A_ROW`, `TABLE_NAME_ELSEWHERE`, `UPDATE_ROWS_FROM_CALLERS`,
 * `COLUMN_BUILDERS`, `TYPED_LANES`); each list is held as a set per file.
 *
 * Known limits (static reading of one file at a time): a table name the file
 * never spells out (`"workflow_" + "executions"`), `Object.assign` onto a row,
 * a row passed to `updateExecutionWithRetry` or its forwarders, and a key whose
 * name is built at run time.
 */
import { describe, expect, it } from "vitest"
import ts from "typescript"
import { SCAN_TIMEOUT_MS, eachSourceFile, parseText } from "./source-scan.js"
import { EXECUTIONS_TABLE, constInit, enclosingFunction, executionWrites, keyWrites, unwrap, type Ancestors, type ExecutionWrite } from "./execution-row-ast.js"
import { SERVER_STAMPED_TRIGGER_TYPES } from "../server-started-runs.js"
import { billingPairColumns } from "../insert-job.js"
import { inlineExecutionColumns } from "../execution-inline-graph.js"
import { executionContentRedaction } from "../app-run-content.js"

/** Calls whose output may be a row or a spread in one (checked to hold neither key below). */
const COLUMN_BUILDERS = new Set(["billingPairColumns", "inlineExecutionColumns", "executionContentRedaction"])
/** The platform's stamp builders: what a stamp-writing lane's insert may store in `trigger_data`. */
const STAMP_BUILDERS = new Set(["appRunStamp", "appRunResumeStamp", "appRenderFinalStamp", "continueFromFailedStamp", "nodeSelectionData"])

/**
 * Each insert into `workflow_executions` and the lane it names, by file, in source order.
 * A lane the source does not spell out as literals must be typed to exclude
 * `manual`, `mcp` and `app_run` (rule 4 then holds it to stamp builders only
 * when it stores `trigger_data`, unless it is listed in `TYPED_LANES`).
 */
const INSERTS: Record<string, readonly string[]> = {
  "lib/plugin-triggers.ts": ["lane"],
  "lib/schedule-fire.ts": ['"schedule"'],
  "lib/trigger-fire-refusal.ts": ["args.triggerType"],
  "routes/api-tokens.ts": ['"api"'],
  "routes/app-run-resume.ts": ['"app_run"'],
  "routes/app-runner.ts": ['"manual"'],
  "routes/presentation.ts": ['"manual"'],
  "routes/telegram-webhook.ts": ['"telegram"'],
  "routes/webhook-triggers.ts": ['"webhook"'],
  "routes/workflow-execution.ts": ['mcpClient ? "mcp" : "manual"'],
  "services/app-execution.ts": ['"app_run"'],
  "services/app-render-final.ts": ['"app_run"'],
  "services/use-case-execution.ts": ['"use_case"'],
}

/** Lanes held in a variable whose type excludes the stamp-writing lanes (file → the lane's text). */
const TYPED_LANES: Record<string, string> = {
  // `PluginTriggerLane`: the plugin lanes only.
  "lib/plugin-triggers.ts": "lane",
  // `"webhook" | "schedule" | "telegram" | "telegram_account"`.
  "lib/trigger-fire-refusal.ts": "args.triggerType",
}

/** A `trigger_type` key that is no row of the table (file → each value's text). */
const NOT_A_ROW: Record<string, readonly string[]> = {
  // A response body that reports a run's lane.
  "ee/routes/admin-app-reports.ts": ["(reportExecution as any).trigger_type ?? null"],
}

/** A direct update whose row its callers build (file → the function it sits in). */
const UPDATE_ROWS_FROM_CALLERS: Record<string, readonly string[]> = {
  // The retry-aware update helper: its row is the caller's `updates`.
  "lib/execution-writes.ts": ["updateExecutionWithRetry"],
}

/** The table's name where it is no query of it (file → the function each sits in). */
const TABLE_NAME_ELSEWHERE: Record<string, readonly string[]> = {
  // An error label.
  "lib/app-expunge-targets.ts": ["readExecutionsById"],
  // A read-back of report sources (select only).
  "lib/app-report-sweep.ts": ["<top>"],
  // The tables a run id is looked up in (select only).
  "middleware/token-workflow-scope.ts": ["workflowOfRun"],
}

/** The lane literals a `trigger_type` value can be, or `null` when it is not spelled out. */
function laneLiterals(e: ts.Expression): string[] | null {
  const at = unwrap(e)
  if (ts.isStringLiteral(at) || ts.isNoSubstitutionTemplateLiteral(at)) return [at.text]
  if (ts.isConditionalExpression(at)) {
    const a = laneLiterals(at.whenTrue)
    const b = laneLiterals(at.whenFalse)
    return a && b ? [...a, ...b] : null
  }
  return null
}

/** Whether a `trigger_data` value is built by a platform stamp builder (or is nothing). */
function platformBuilt(e: ts.Expression, ancestors: Ancestors, depth = 0): boolean {
  const at = unwrap(e)
  if (at.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(at) && at.text === "undefined")) return true
  if (ts.isCallExpression(at) && ts.isIdentifier(at.expression)) return STAMP_BUILDERS.has(at.expression.text)
  if (ts.isConditionalExpression(at)) return platformBuilt(at.whenTrue, ancestors, depth + 1) && platformBuilt(at.whenFalse, ancestors, depth + 1)
  if (ts.isIdentifier(at) && depth < 8) {
    const bound = constInit(at.text, ancestors)
    return !!bound && platformBuilt(bound.init, bound.ancestors, depth + 1)
  }
  return false
}

interface Scan {
  readonly findings: string[]
  /** Each insert's lane text, by file. */
  readonly inserts: Map<string, string[]>
  /** `file@offset` of each lane value an insert names (the only `trigger_type` writes rule 2 allows). */
  readonly insertLanes: Set<string>
}

const laneKey = (rel: string, sf: ts.SourceFile, node: ts.Node) => `${rel}@${node.getStart(sf)}`

/**
 * Hold a file's entries against its list as sets: each entry the list does not
 * name is a finding, and so is each listed entry the file no longer has.
 */
function againstList<T>(rel: string, found: readonly T[], keyOf: (t: T) => string, listed: readonly string[], report: (t: T) => string, listName: string): string[] {
  const allowed = new Set(listed)
  const present = new Set(found.map(keyOf))
  return [
    ...found.filter((t) => !allowed.has(keyOf(t))).map(report),
    ...[...allowed].filter((k) => !present.has(k)).map((k) => `${rel}: ${listName} lists "${k}", which the file no longer has — remove it from ${listName}`),
  ]
}

function scanFile(
  sf: ts.SourceFile,
  rel: string,
  scan: Scan,
  lists = { typedLanes: TYPED_LANES, elsewhere: TABLE_NAME_ELSEWHERE, updatesFromCallers: UPDATE_ROWS_FROM_CALLERS },
): void {
  const { writes, strays, unreadHelperTables } = executionWrites(sf, COLUMN_BUILDERS)
  for (const line of unreadHelperTables) {
    scan.findings.push(`${rel}:${line} an insert helper's table is not a string the guard can read — pass the table name as a literal`)
  }
  scan.findings.push(
    ...againstList(
      rel,
      strays,
      (s) => s.fn,
      lists.elsewhere[rel] ?? [],
      (s) =>
        `${rel}:${s.line} the table name where the guard cannot follow it to a query (in ${s.fn}) — write the query as .from("${EXECUTIONS_TABLE}").<method>(…) in place; if this mention is no query of the table (a label, a read-only table list), list ${s.fn} under TABLE_NAME_ELSEWHERE`,
      "TABLE_NAME_ELSEWHERE",
    ),
  )
  for (const w of writes.filter((x: ExecutionWrite) => x.kind === "insert")) checkInsert(sf, rel, w, scan, lists.typedLanes)
  // A direct update's row is visible too, unless it is a listed helper forwarding its callers' rows.
  const blindUpdates = writes.filter((x) => x.kind === "update" && x.blind.length > 0)
  scan.findings.push(
    ...againstList(
      rel,
      blindUpdates,
      (w) => enclosingFunction(sf, w.ancestors),
      lists.updatesFromCallers[rel] ?? [],
      (w) =>
        `${rel}:${w.line} ${w.via}: ${w.blind.join("; ")} — build the update's row in place (a spread may use a COLUMN_BUILDERS call); a helper that only forwards its callers' rows goes under UPDATE_ROWS_FROM_CALLERS`,
      "UPDATE_ROWS_FROM_CALLERS",
    ),
  )
}

function checkInsert(sf: ts.SourceFile, rel: string, w: ExecutionWrite, scan: Scan, typedLanes: Record<string, string>): void {
  const at = `${rel}:${w.line}`
  // Each lane value the rows name directly is this insert's own (rule 2 allows it), whatever else fails below.
  for (const lane of w.shapes.flatMap((s) => s.direct.get("trigger_type") ?? [])) scan.insertLanes.add(laneKey(rel, sf, lane))
  if (w.blind.length > 0) {
    scan.findings.push(`${at} ${w.via}: ${w.blind.join("; ")} — build the row in place; a call whose output never holds trigger_type or trigger_data may go under COLUMN_BUILDERS (with its runtime check below)`)
    return
  }
  if (w.shapes.length === 0) scan.findings.push(`${at} ${w.via}: no row`)
  for (const shape of w.shapes) {
    const lanes = shape.direct.get("trigger_type") ?? []
    if (lanes.length !== 1 || shape.spread.has("trigger_type")) {
      scan.findings.push(
        `${at} ${w.via}: a row that does not name its trigger_type once, unconditionally — write trigger_type: "<lane>" as a top-level key of the row, and set it in no spread (a spread can override it)`,
      )
      continue
    }
    const lane = lanes[0]!
    const text = lane.getText(sf).replace(/\s+/g, " ")
    scan.inserts.set(rel, [...(scan.inserts.get(rel) ?? []), text])
    const data = [...(shape.direct.get("trigger_data") ?? []), ...(shape.spread.get("trigger_data") ?? [])]
    if (data.length === 0) continue
    const literals = laneLiterals(lane)
    const mayBeStampLane = literals === null ? typedLanes[rel] !== text : literals.some((l) => SERVER_STAMPED_TRIGGER_TYPES.includes(l))
    if (!mayBeStampLane) continue
    for (const value of data) {
      if (!platformBuilt(value, w.ancestors)) {
        scan.findings.push(
          `${at} ${w.via}: a ${text} run's trigger_data is not built by a platform stamp builder — a manual/mcp/app_run row stores only a STAMP_BUILDERS result; a lane variable whose type excludes those lanes goes under TYPED_LANES`,
        )
      }
    }
  }
}

function scanTypeWrites(sf: ts.SourceFile, rel: string, scan: Scan, notARow = NOT_A_ROW): void {
  const others = keyWrites(sf, "trigger_type").filter((k) => !scan.insertLanes.has(laneKey(rel, sf, k.node)))
  scan.findings.push(
    ...againstList(
      rel,
      others,
      (k) => k.value,
      notARow[rel] ?? [],
      (k) =>
        `${rel}:${k.line} trigger_type written outside an insert's row (${k.value}) — a run's lane is set once, at its insert; if this object is no row of the table (a response body, a schema, a read filter), list its value under NOT_A_ROW`,
      "NOT_A_ROW",
    ),
  )
}

const newScan = (): Scan => ({ findings: [], inserts: new Map(), insertLanes: new Set() })

describe("every workflow_executions insert names its lane", { timeout: SCAN_TIMEOUT_MS }, () => {
  const scan = newScan()
  eachSourceFile([EXECUTIONS_TABLE, "insertWithIdempotencyKey"], (sf, rel) => scanFile(sf, rel, scan))
  eachSourceFile(["trigger_type"], (sf, rel) => scanTypeWrites(sf, rel, scan))

  it("finds the inserts (the guard is wired to something)", () => {
    expect([...scan.inserts.values()].flat().length).toBeGreaterThanOrEqual(13)
    expect(scan.inserts.get("routes/workflow-execution.ts")).toEqual(['mcpClient ? "mcp" : "manual"'])
  })

  it("names trigger_type in every row, writes it nowhere else, and keeps stamp lanes to stamps", () => {
    expect(scan.findings, "each finding says what to change, or which list to add it to").toEqual([])
  })

  it("lists every insert and its lane", () => {
    expect(Object.fromEntries([...scan.inserts.entries()].sort(([a], [b]) => a.localeCompare(b))), "add the new insert's lane to INSERTS").toEqual(INSERTS)
  })

  it("the column builders a row may spread write neither key", () => {
    const outputs = [
      billingPairColumns(undefined),
      billingPairColumns({ payer: "workspace", workspaceId: "w", orgId: "o" } as never),
      inlineExecutionColumns({} as never, "job-1"),
      executionContentRedaction(),
    ]
    for (const out of outputs) {
      expect(Object.keys(out)).not.toContain("trigger_type")
      expect(Object.keys(out)).not.toContain("trigger_data")
    }
    expect([...COLUMN_BUILDERS].sort()).toEqual(["billingPairColumns", "executionContentRedaction", "inlineExecutionColumns"])
  })
})

describe("the insert guard matches every shape it exists for (self-test)", () => {
  const run = (source: string) => {
    const scan = newScan()
    const sf = parseText("x.ts", source)
    scanFile(sf, "x.ts", scan, { typedLanes: { "x.ts": "lane" }, elsewhere: {}, updatesFromCallers: {} })
    scanTypeWrites(sf, "x.ts", scan, {})
    return scan
  }

  it.each([
    ["an object literal with no lane", `supabase.from("workflow_executions").insert({ workflow_id: w, user_id: u, trigger_data: body })`, ["does not name its trigger_type"]],
    ["a spread of a row built elsewhere", `insertWithIdempotencyKey("workflow_executions", { user_id: u, trigger_type: "webhook", ...row }, key)`, ["cannot see into"]],
    ["a row handed in", `function f(row) { return supabase.from("workflow_executions").insert(row) }`, ["is not visible"]],
    ["an array with one row that names no lane", `supabase.from("workflow_executions").insert([{ user_id: u, trigger_type: "webhook" }, { user_id: u }])`, ["does not name its trigger_type"]],
    // Named only conditionally (rule 1), and so written outside the row's own lane (rule 2).
    ["a lane only in a conditional spread", `supabase.from("workflow_executions").insert({ user_id: u, ...(x ? { trigger_type: "webhook" } : {}) })`, ["does not name its trigger_type", "outside an insert's row"]],
    ["a computed key the guard cannot read", `function f(k) { return supabase.from("workflow_executions").insert({ [k]: "webhook", trigger_type: "webhook" }) }`, ["computed key"]],
    ["a .map row with no lane", `supabase.from("workflow_executions").insert(items.map((i) => ({ user_id: i })))`, ["does not name its trigger_type"]],
    ["a const row with no lane", `const row = { user_id: u, trigger_data: body }\nsupabase.from("workflow_executions").insert(row)`, ["does not name its trigger_type"]],
    ["a table-name const", `const T = "workflow_executions"\nsupabase.from(T).insert({ user_id: u })`, ["cannot follow it to a query"]],
    ["a builder held apart from its call", `const q = supabase.from("workflow_executions")\nq.insert({ user_id: u })`, ["cannot follow it to a query"]],
    ["a wrapper that takes a table", `put("workflow_executions", { user_id: u })`, ["cannot follow it to a query"]],
    ["an insert helper handed a table it cannot read", `function f(table) { return insertWithIdempotencyKey(table, { user_id: u }, key) }`, ["insert helper's table"]],
    ["a stamp lane storing data no stamp builder made", `supabase.from("workflow_executions").insert({ user_id: u, trigger_type: "manual", trigger_data: body })`, ["platform stamp builder"]],
    ["a stamp lane storing a conditional of caller data", `supabase.from("workflow_executions").insert({ user_id: u, trigger_type: x ? "mcp" : "manual", ...(s ? { trigger_data: appRunStamp(r) } : { trigger_data: body }) })`, ["platform stamp builder"]],
    ["an unlisted lane variable storing data", `function f(other) { return supabase.from("workflow_executions").insert({ user_id: u, trigger_type: other, trigger_data: body }) }`, ["platform stamp builder"]],
    ["an update spreading a row built elsewhere", `supabase.from("workflow_executions").update({ status: "x", ...patch }).eq("id", id)`, ["cannot see into"]],
    ["an update writing a row handed in", `function f(patch) { return supabase.from("workflow_executions").update(patch).eq("id", id) }`, ["is not visible"]],
    // The override sits on the same line as the row's own lane, which a line-keyed check would let through.
    ["a lane a one-line spread can override", `supabase.from("workflow_executions").insert({ user_id: u, trigger_type: "webhook", trigger_data: body, ...(x ? { trigger_type: other } : {}) })`, ["does not name its trigger_type", "outside an insert's row"]],
    ["a lane set by an update", `supabase.from("workflow_executions").update({ trigger_type: "manual" }).eq("id", id)`, ["outside an insert's row"]],
    ["a lane set by a member assignment", `row.trigger_type = "manual"`, ["outside an insert's row"]],
    ["a lane removed from a row", `delete row["trigger_type"]`, ["outside an insert's row"]],
    ["a lane in a row built for a helper", `const row = { user_id: u, trigger_type: "manual" }\nsave(row)`, ["outside an insert's row"]],
  ] as Array<[string, string, string[]]>)("%s", (_name, source, expected) => {
    const findings = run(source).findings
    expect(findings).toHaveLength(expected.length)
    expected.forEach((fragment, i) => expect(findings[i]).toContain(fragment))
  })

  it("holds a file's listed entries as a set: order and repeats are fine, a stale entry is not", () => {
    const source = `function a() { log("workflow_executions") }\nfunction b() { log("workflow_executions"); log("workflow_executions") }`
    const scanOf = (elsewhere: Record<string, readonly string[]>) => {
      const scan = newScan()
      scanFile(parseText("x.ts", source), "x.ts", scan, { typedLanes: {}, elsewhere, updatesFromCallers: {} })
      return scan.findings
    }
    expect(scanOf({ "x.ts": ["b", "a"] })).toEqual([])
    expect(scanOf({ "x.ts": ["a"] })).toHaveLength(2)
    expect(scanOf({ "x.ts": ["a", "b", "c"] })).toEqual([expect.stringContaining('lists "c"')])
  })

  it("passes the shapes the platform writes", () => {
    const scan = run(`
      supabase.from("workflow_executions").insert({ workflow_id: w, user_id: u, status: "pending", trigger_type: "webhook", trigger_data: triggerData, ...billingPairColumns(ctx) })
      insertWithIdempotencyKey("workflow_executions", { user_id: u, trigger_type: mcp ? "mcp" : "manual", ...(stamp ? { trigger_data: continueFromFailedStamp(stamp) } : sel ? { trigger_data: sel } : {}), ...(mcp ? { mcp_client: mcp } : {}) }, key)
      const selection = nodeSelectionData(ids)
      const sel = selection.nodeSelection ? selection : null
      const row = { user_id: u, trigger_type: "schedule", trigger_data: { cron: c } }
      void (supabase.from("workflow_executions") as any).insert(row)
      supabase.from("workflow_executions").insert([{ user_id: u, trigger_type: "api" }, { user_id: u, trigger_type: "api" }])
      supabase.from("workflow_executions").insert(items.map((i) => ({ user_id: i, trigger_type: "telegram" })))
      function f(lane) { return supabase.from("workflow_executions").insert({ user_id: u, trigger_type: lane, trigger_data: body }) }
      supabase.from("workflow_executions").update({ status: "failed" }).eq("id", id)
      supabase.from("workflow_executions").update(executionContentRedaction()).in("id", ids)
      findIdempotentRow("workflow_executions", u, key)
      type Table = "jobs" | "workflow_executions"
    `)
    expect(scan.findings).toEqual([])
    expect([...scan.inserts.values()].flat()).toHaveLength(7)
  })
})

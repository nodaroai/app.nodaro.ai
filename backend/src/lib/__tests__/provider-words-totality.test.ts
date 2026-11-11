// @test-watches backend/src/**/*.ts
/**
 * A FAILED JOB'S PROVIDER WORDS — TOTALITY (`jobs.errorDetail` on the surface
 * profile, `lib/provider-words.ts`). A deployment that keeps the provider's own
 * words about a failure for its admins must not hand them to anyone else from a
 * place nobody remembered: every serving of them goes through the one funnel,
 * and a new place that serves them outside it fails this build.
 *
 * The words live in two places: `jobs.error_detail`, and a run's node states
 * (`workflow_executions.node_states`, and the live `executionEvents`), where the
 * orchestrator copies them as `errorDetail`. So the nets, all textual:
 *
 *  1. the setting has ONE reader (`surfaceJobErrorDetailReaders`, in
 *     surface-profile.ts) and ONE caller (`providerWordsShown`, the decision in
 *     provider-words.ts), and every shape the funnel exports asks that decision;
 *  2. the job-row wrappers every job read already applies delegate to the
 *     funnel (`maskTrendRunError` → `jobRowProviderWords`; `sanitizeJobForPublic`,
 *     `maskTrendRunErrors` → `maskTrendRunError`; `appRunViewStates` →
 *     `withoutNodeStateProviderWords`);
 *  3. WORDS: every shipped file whose code names `error_detail` / `errorDetail`
 *     is classified — it serves them through the funnel (verified), serves them
 *     to admins only (verified), writes them, carries them onto a node state,
 *     or reads them for something no user reads — and so is every file whose
 *     code names `PUBLIC_JOB_KEYS`, the key list that carries the column;
 *  4. NODE STATES: every file whose code names `node_states` or listens to
 *     `executionEvents` is classified — it serves the states through the
 *     funnel (verified), serves only fields it names and never the words
 *     (verified: it never names `errorDetail`), or reads them server-side;
 *  5. WHOLE ROWS: no read of a whole `jobs` row (`select("*")`), and a whole
 *     `workflow_executions` row is read only where the states are served
 *     through the funnel;
 *  6. a webhook body recorded before the setting (a retry, the delivery log)
 *     passes the funnel too.
 *
 * What the nets cannot see, stated: a column list built in one file and
 * selected in another (the file that spells the column is the one classified,
 * and its reason names its readers), and a value copied out of a served row
 * into a new key by hand (the reviewer's job, as anywhere).
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { SCAN_TIMEOUT_MS, SRC, eachSourceFile, lineOf, relPath, sourceFiles, walk } from "./source-scan.js"

const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

interface SourceFile { readonly rel: string; readonly code: string }

let files: readonly SourceFile[] | undefined
/** Every shipped backend file, comments stripped — read once per run. */
function shipped(): readonly SourceFile[] {
  return (files ??= sourceFiles().map((file) => ({ rel: relPath(file), code: withoutComments(readFileSync(file, "utf8")) })))
}
const codeOf = (rel: string): string => {
  const found = shipped().find((f) => f.rel === rel)
  expect(found, `${rel} is not a shipped file under ${SRC}`).toBeDefined()
  return found!.code
}

/** The words, by either spelling (the column, the node-state / envelope key). */
const NAMES_THE_WORDS = /\berror_detail\b|\berrorDetail\b/
const NAMES_THE_KEY_LIST = /\bPUBLIC_JOB_KEYS\b/
const NAMES_NODE_STATES = /\bnode_states\b/
const LISTENS_TO_RUN_EVENTS = /\bexecutionEvents\.(?:on|once|addListener|prependListener)\(/
/** A call of the funnel, or of a wrapper that is held (below) to delegate to it. */
const THROUGH_THE_FUNNEL = /\b(?:providerWordsShown|jobRowProviderWords|nodeStatesProviderWords|withoutNodeStateProviderWords|webhookBodyProviderWords|maskTrendRunErrors?|sanitizeJobForPublic|appRunViewStates)\s*\(/
const ADMIN_ONLY = /\brequireAdmin\b/

type WordsKind = "funnel" | "setting" | "serves" | "admin" | "writes" | "carries" | "internal"
interface Lane<K> { readonly kind: K; readonly why: string }
const lane = <K>(kind: K, why: string): Lane<K> => ({ kind, why })

/**
 * Every file whose code names a failed job's provider words (or the key list
 * that carries them), and what it does with them.
 */
const WORDS: Readonly<Record<string, Lane<WordsKind>>> = {
  "lib/provider-words.ts": lane("funnel", "the funnel: the one decision and the shapes each surface serves the words in"),
  "lib/surface-profile.ts": lane("setting", "parses `jobs.errorDetail` and its one reader, surfaceJobErrorDetailReaders"),
  "lib/public-job-data.ts": lane("serves", "maskTrendRunError, which every job read applies, hands each row to jobRowProviderWords first"),
  "routes/jobs.ts": lane("serves", "the job reads (list, by id, both status polls, batch-status) through maskTrendRunError(s) / sanitizeJobForPublic; PUBLIC_JOB_KEYS names the column"),
  "lib/webhooks/event.ts": lane("serves", "a job event's body is sanitizeJobForPublic's non-admin row over PUBLIC_JOB_KEYS; a kept body passes webhookBodyProviderWords"),
  "lib/mcp/tools/_job-view.ts": lane("serves", "the MCP job envelope maps errorDetail through jobRowProviderWords as a non-admin reader"),
  "lib/mcp/tools/jobs.ts": lane("serves", "list_jobs / get_job / wait_for_job select the column and pass every row through maskTrendRunError(s)"),
  "lib/mcp/tools/gallery.ts": lane("serves", "get_asset selects the column and passes the row through maskTrendRunError before reading it"),
  "lib/mcp/tools/diagnose.ts": lane("serves", "diagnose_run's providerReason (the job's words, else the node state's) goes through maskTrendRunError"),
  "ee/routes/admin-jobs.ts": lane("admin", "the admin one-job and child-jobs reads, behind requireAdmin: admins keep the words"),
  "lib/job-failure.ts": lane("writes", "markJobFailed writes the column a failure's caller hands it"),
  "lib/reconcile/bump-attempts.ts": lane("writes", "writes the redacted reason an exhausted reconcile gives up on"),
  "lib/reconcile/elevenlabs.ts": lane("writes", "writes the provider's failure a reconcile finds"),
  "lib/reconcile/fal.ts": lane("writes", "writes the provider's failure a reconcile finds"),
  "lib/reconcile/kie.ts": lane("writes", "writes the provider's failure a reconcile finds"),
  "lib/reconcile/nodaro-cloud.ts": lane("writes", "writes the relayed job's failure a reconcile finds"),
  "lib/reconcile/replicate.ts": lane("writes", "writes the provider's failure a reconcile finds"),
  "lib/private-plugins/toolkit.ts": lane("writes", "a plugin's failJob writes its redacted detail; the plugin's job reads do not select the column"),
  "routes/character-training.ts": lane("writes", "a training job that fails at the provider writes the redacted detail; its answers carry the platform sentence only"),
  "workers/video-worker.ts": lane("writes", "the worker writes a failed job's redacted provider detail"),
  "services/workflow-engine/node-executor.ts": lane("carries", "reads a failed child job's words onto the thrown error, for the orchestrator to copy onto the node state"),
  "services/workflow-engine/sub-workflow-handler.ts": lane("carries", "carries an inner node's words onto the sub-workflow node's rewrapped error"),
  "workers/orchestrator-worker.ts": lane("carries", "copies a failed node's words onto its node state; the states are served only through the NODE_STATES lanes below"),
  "services/workflow-engine/types.ts": lane("carries", "declares NodeExecutionState.errorDetail"),
  "lib/app-report-sweep.ts": lane("internal", "copies a failed job's words into an app report, which only admins read (app_reports: admin-read RLS, /admin/app-reports)"),
  "lib/app-run-content.ts": lane("internal", "the expunge's column list: clears the words, never reads them out"),
}

type StatesKind = "serves" | "fields" | "internal"

/**
 * Every file whose code names `node_states` or listens to a run's live events,
 * and what it does with the states.
 */
const NODE_STATES: Readonly<Record<string, Lane<StatesKind>>> = {
  "routes/workflow-execution.ts": lane("serves", "the run reads, the stream's snapshots and live events, and both run lists pass the states through nodeStatesProviderWords with the reader's role"),
  "routes/presentation.ts": lane("serves", "a shared workflow's run status passes node_states through nodeStatesProviderWords"),
  "routes/app-runner.ts": lane("serves", "a published app's runner reads the states through appRunViewStates, which never carries the words"),
  "lib/mcp/tools/diagnose.ts": lane("serves", "lists each node's id, type, status and job only; a failed node's words go through maskTrendRunError (providerReason)"),
  "lib/mcp/tools/gallery.ts": lane("serves", "get_app_run serves summarizeNodeStates' named fields only; the file's job read (get_asset) serves the words through maskTrendRunError"),
  "lib/execution-result.ts": lane("fields", "summarizeNodeStates / formatExecutionResult: outputs, status, error, skip reason — named fields only"),
  "routes/api-tokens.ts": lane("fields", "the API token's status and result: counts, outcome and formatExecutionResult's outputs"),
  "ee/copilot/tools/get-graph.ts": lane("fields", "the Copilot's view of the last run: each node's status and error sentence"),
  "ee/copilot/tools/run-and-execution.ts": lane("fields", "the Copilot's get_execution: each node's status, type, job and error sentence"),
  "lib/mcp/progress-emitter.ts": lane("fields", "an MCP widget's live update: each node's status and output"),
  "routes/component-execute.ts": lane("fields", "collects the component's outputs from its inner run's states"),
  "routes/app-render-final.ts": lane("internal", "reads the runner's edits (app_runs.node_states) to plan a Render final"),
  "lib/app-run-final-column.ts": lane("internal", "loads a run's Render finals for appRunViewStates"),
  "lib/app-run-ownership.ts": lane("internal", "names the app_runs columns an ownership check reads"),
  "lib/app-expunge-targets.ts": lane("internal", "finds the jobs an app's runs point at, to expunge them"),
  "lib/app-report-sweep.ts": lane("internal", "copies a failed run's states into an app report, which only admins read"),
  "lib/app-run-content.ts": lane("internal", "the expunge's column list: clears the states"),
  "lib/collect-app-r2-keys.ts": lane("internal", "collects the storage keys an app's runs hold, to delete them"),
  "lib/concurrency-lanes/execution-wait.ts": lane("internal", "reads the in-flight inner runs a run's clock waits on"),
  "lib/execution-budget.ts": lane("internal", "reads a run's budgeted dispatches for its time limits"),
  "lib/execution-inline-graph.ts": lane("internal", "loads a use-case wrapper's inner run to finalize the wrapper"),
  "lib/job-finalize.ts": lane("internal", "writes a finished job's result into its run's node state"),
  "lib/use-case/execution-wrappers.ts": lane("internal", "finds a run's live use-case wrapper jobs"),
  "lib/reconcile/workflow-executions-cron.ts": lane("internal", "fails a stuck run and its states"),
  "services/workflow-engine/run-continuation.ts": lane("internal", "loads an earlier run's states to seed a continuation; the routes read named fields of it"),
  "workers/orchestrator-worker.ts": lane("internal", "writes the run's states and emits its live events"),
  "workers/orchestrator-cancel.ts": lane("internal", "writes a cancelled run's states and emits its event"),
  "scripts/recover-stuck-execution.ts": lane("internal", "an operator's recovery script"),
}

/** Tables whose whole row (`select("*")`, or `select()`) is read, by file. */
function wholeRowReads(): Array<{ table: string; where: string; rel: string }> {
  const found: Array<{ table: string; where: string; rel: string }> = []
  eachSourceFile(['"jobs"', "'jobs'", '"workflow_executions"', "'workflow_executions'"], (sf, rel) => {
    walk(sf, (n) => {
      if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== "select") return
      const table = rootTable(n)
      if (table !== "jobs" && table !== "workflow_executions") return
      const arg = n.arguments[0]
      const whole = !arg || (ts.isStringLiteralLike(arg) && arg.text.trim() === "*")
      if (whole) found.push({ table, where: `${rel}:${lineOf(sf, n)}`, rel })
    })
  })
  return found
}

/** The table a query chain's `.from("…")` names, or null when the chain is not rooted at one. */
function rootTable(call: ts.CallExpression): string | null {
  let r: ts.Expression = (call.expression as ts.PropertyAccessExpression).expression
  for (;;) {
    if (ts.isCallExpression(r) && ts.isPropertyAccessExpression(r.expression)) {
      if (r.expression.name.text === "from") {
        const a = r.arguments[0]
        return a && ts.isStringLiteralLike(a) ? a.text : null
      }
      r = r.expression.expression
    } else if (ts.isPropertyAccessExpression(r) || ts.isNonNullExpression(r) || ts.isParenthesizedExpression(r) || ts.isAwaitExpression(r)) {
      r = r.expression
    } else {
      return null
    }
  }
}

/** A function's body text, from its declaration to the matching close (comments stripped). */
function bodyOf(code: string, name: string): string {
  const start = code.search(new RegExp(`export function ${name}\\b`))
  expect(start, `${name} is not found`).toBeGreaterThan(-1)
  let depth = 0
  for (let i = code.indexOf("{", code.indexOf(")", start)); i < code.length; i++) {
    if (code[i] === "{") depth++
    else if (code[i] === "}" && --depth === 0) return code.slice(start, i + 1)
  }
  throw new Error(`${name}'s body does not close`)
}

describe("the scan recognizes what it counts", () => {
  it("each pattern matches its shape and not a near miss", () => {
    expect(NAMES_THE_WORDS.test("select('id, error_detail')")).toBe(true)
    expect(NAMES_THE_WORDS.test("state.errorDetail")).toBe(true)
    expect(NAMES_THE_WORDS.test("errorDetailOf(err)")).toBe(false)
    expect(NAMES_THE_WORDS.test(withoutComments("// the error_detail column\n/* errorDetail */"))).toBe(false)
    expect(NAMES_NODE_STATES.test(`.select("id, node_states")`)).toBe(true)
    expect(LISTENS_TO_RUN_EVENTS.test("executionEvents.on(execId, handler)")).toBe(true)
    expect(LISTENS_TO_RUN_EVENTS.test("executionEvents.emit(id, event)")).toBe(false)
    expect(THROUGH_THE_FUNNEL.test("nodeStatesProviderWords(states, isAdmin)")).toBe(true)
    expect(THROUGH_THE_FUNNEL.test("maskTrendRunErrors(rows, false)")).toBe(true)
    expect(THROUGH_THE_FUNNEL.test("import { maskTrendRunError } from")).toBe(false)
  })

  it("the scan is wired to something", () => {
    expect(shipped().length).toBeGreaterThan(500)
    expect(shipped().filter((f) => NAMES_THE_WORDS.test(f.code)).length).toBeGreaterThan(15)
    expect(shipped().filter((f) => NAMES_NODE_STATES.test(f.code)).length).toBeGreaterThan(15)
  }, SCAN_TIMEOUT_MS)
})

describe("the setting has one reader, and the funnel is its one caller", () => {
  it("surfaceJobErrorDetailReaders is called only by the funnel's decision", () => {
    const callers = shipped().filter((f) => /\bsurfaceJobErrorDetailReaders\s*\(/.test(f.code) && f.rel !== "lib/surface-profile.ts").map((f) => f.rel)
    expect(callers, "only lib/provider-words.ts may read the setting: every other place asks providerWordsShown").toEqual(["lib/provider-words.ts"])
    expect(bodyOf(codeOf("lib/provider-words.ts"), "providerWordsShown")).toMatch(/surfaceJobErrorDetailReaders\(\)/)
  }, SCAN_TIMEOUT_MS)

  it("no file but the profile's own reads the key off the profile", () => {
    const readers = shipped().filter((f) => /\.jobs\??\.errorDetail\b/.test(f.code)).map((f) => f.rel)
    expect(readers).toEqual(["lib/surface-profile.ts"])
  }, SCAN_TIMEOUT_MS)

  it("every shape the funnel serves the words in asks the one decision", () => {
    const funnel = codeOf("lib/provider-words.ts")
    for (const shape of ["jobRowProviderWords", "nodeStatesProviderWords", "webhookBodyProviderWords"]) {
      expect(bodyOf(funnel, shape), `${shape} does not ask providerWordsShown`).toMatch(/providerWordsShown\(/)
    }
  })
})

describe("the wrappers every read already applies delegate to the funnel", () => {
  it("maskTrendRunError hands the row to jobRowProviderWords before anything else", () => {
    const body = bodyOf(codeOf("lib/public-job-data.ts"), "maskTrendRunError")
    expect(body).toMatch(/\{\s*const rec = jobRowProviderWords\(row, isAdmin\)/)
    expect(body, "the row it returns must be the funnel's, never the row it was given").not.toMatch(/return row\b/)
    expect(bodyOf(codeOf("lib/public-job-data.ts"), "maskTrendRunErrors")).toMatch(/maskTrendRunError\(row, isAdmin\)/)
  })

  it("sanitizeJobForPublic masks before it picks the keys", () => {
    expect(bodyOf(codeOf("routes/jobs.ts"), "sanitizeJobForPublic")).toMatch(/maskTrendRunError\(redactPrivateJobData\(job\), isAdmin\)/)
  })

  it("a published app's runner's states never carry the words", () => {
    expect(bodyOf(codeOf("lib/app-run-states.ts"), "appRunViewStates")).toMatch(/withoutNodeStateProviderWords\(/)
  })
})

describe("every file that names the words is classified", () => {
  it("each one, and each user of the key list that carries the column", () => {
    const naming = shipped().filter((f) => NAMES_THE_WORDS.test(f.code) || NAMES_THE_KEY_LIST.test(f.code)).map((f) => f.rel).sort()
    const unclassified = naming.filter((rel) => !(rel in WORDS))
    expect(
      unclassified,
      "a file names a failed job's provider words (error_detail / errorDetail / PUBLIC_JOB_KEYS) but is not classified in WORDS: " +
        "serve them through lib/provider-words.ts (or a wrapper that delegates to it) and classify it, or say why it never serves them",
    ).toEqual([])
    const stale = Object.keys(WORDS).filter((rel) => !naming.includes(rel))
    expect(stale, "WORDS lists files that no longer name the words: remove them").toEqual([])
    for (const [rel, l] of Object.entries(WORDS)) expect(l.why.length, `${rel}: say why`).toBeGreaterThan(20)
  }, SCAN_TIMEOUT_MS)

  it("a file that serves them goes through the funnel, and an admin one is behind requireAdmin", () => {
    for (const [rel, l] of Object.entries(WORDS)) {
      const code = codeOf(rel)
      if (l.kind === "serves") expect(THROUGH_THE_FUNNEL.test(code), `${rel} is marked serves but never calls the funnel`).toBe(true)
      if (l.kind === "admin") expect(ADMIN_ONLY.test(code), `${rel} is marked admin but has no requireAdmin`).toBe(true)
    }
  }, SCAN_TIMEOUT_MS)
})

describe("every file that reads a run's node states is classified", () => {
  it("each one, and each listener of a run's live events", () => {
    const reading = shipped().filter((f) => NAMES_NODE_STATES.test(f.code) || LISTENS_TO_RUN_EVENTS.test(f.code)).map((f) => f.rel).sort()
    const unclassified = reading.filter((rel) => !(rel in NODE_STATES))
    expect(
      unclassified,
      "a file reads a run's node states (or its live events) but is not classified in NODE_STATES: " +
        "a failed node's state carries the provider's words (errorDetail). Serve the states through nodeStatesProviderWords, " +
        "serve only fields you name, or say why they are never served",
    ).toEqual([])
    const stale = Object.keys(NODE_STATES).filter((rel) => !reading.includes(rel))
    expect(stale, "NODE_STATES lists files that no longer read node states: remove them").toEqual([])
    for (const [rel, l] of Object.entries(NODE_STATES)) expect(l.why.length, `${rel}: say why`).toBeGreaterThan(20)
  }, SCAN_TIMEOUT_MS)

  it("a file that serves them goes through the funnel; one that serves named fields never names the words", () => {
    for (const [rel, l] of Object.entries(NODE_STATES)) {
      const code = codeOf(rel)
      if (l.kind === "serves") expect(THROUGH_THE_FUNNEL.test(code), `${rel} is marked serves but never calls the funnel`).toBe(true)
      if (l.kind === "fields") expect(NAMES_THE_WORDS.test(code), `${rel} is marked fields but names the provider's words: route it through the funnel and mark it serves`).toBe(false)
    }
  }, SCAN_TIMEOUT_MS)
})

describe("whole rows", () => {
  it("no read takes a whole jobs row, and a whole run row is read only where its states are served through the funnel", () => {
    const reads = wholeRowReads()
    const jobs = reads.filter((r) => r.table === "jobs").map((r) => r.where)
    expect(jobs, "a whole jobs row carries error_detail: name the columns you read").toEqual([])
    for (const r of reads.filter((x) => x.table === "workflow_executions")) {
      expect(NODE_STATES[r.rel]?.kind, `${r.where} reads a whole run row (its node states included) outside a serves lane`).toBe("serves")
    }
    expect(reads.length, "the whole-row scan found nothing: it is wired to nothing").toBeGreaterThan(0)
  }, SCAN_TIMEOUT_MS)
})

describe("a webhook body recorded before the setting", () => {
  it("is sent again, and shown in the delivery log, through the funnel", () => {
    expect(codeOf("lib/webhooks/event.ts")).toMatch(/body: webhookBodyProviderWords\(d\.payload\), fresh: false/)
    expect(codeOf("lib/webhooks/endpoints.ts")).toMatch(/requestBody: !hideBody && typeof row\.payload === "string" \? webhookBodyProviderWords\(row\.payload\) : null/)
  })
})

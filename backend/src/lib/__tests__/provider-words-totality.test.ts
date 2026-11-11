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
 *     passes the funnel too;
 *  7. WHOSE WORDS (decided 2026-11-11): a job's words are its owner's, a run's
 *     are a reader's who can open the run's workflow, a share page's saved
 *     ones are its creator's. So a `jobs` read naming `error_detail` whose own
 *     chain does not pin `.eq("user_id", …)` — one that can return someone
 *     else's job — is counted per file and classified, and one that serves
 *     other users' jobs must judge each row by its owner
 *     (`jobRowProviderWordsFor`); a file that serves a run's states with the
 *     words must establish the reader's relation to the run (a lookup in
 *     lib/provider-words-readers.ts), never pass `canRead: true` by hand; and
 *     the share page's saved nodes and the share link's run status are pinned;
 *  8. A RUN'S JOBS (decided 2026-11-11): a job that belongs to a run
 *     (`workflow_execution_id` set) is judged by the run's workflow, like the
 *     run itself — its owner (whoever started the run) reads its words only
 *     when they can open that workflow. So every `jobs` read naming
 *     `error_detail` also reads `workflow_execution_id` in a file that passes
 *     its rows through `runJobsProviderWords` (lib/provider-words-readers.ts),
 *     or is counted and classified (the jobs of one run, judged by that run's
 *     workflow; other users' jobs only; an admin route). The webhook body's
 *     reads are pinned by text.
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
const THROUGH_THE_FUNNEL = /\b(?:providerWordsShown(?:To)?|jobRowProviderWords(?:For)?|runStatesProviderWords|withoutNodeStateProviderWords|savedNodesProviderWords|webhookBodyProviderWords|maskTrendRunErrors?|sanitizeJobForPublic|appRunViewStates)\s*\(/
/** A call that serves a run's states (or what they say) as a reader may read them. */
const RUN_STATES_SHAPE = /\b(?:runStatesProviderWords|providerWordsShownTo|withoutNodeStateProviderWords|appRunViewStates)\s*\(/
/** A shape that shows the words only when told the reader may read them — it needs the relation looked up. */
const NEEDS_A_RELATION = /\b(?:runStatesProviderWords|providerWordsShownTo)\s*\(/
/** The lookups of a reader's relation to a run (lib/provider-words-readers.ts). */
const LOOKS_UP_THE_RELATION = /\b(?:runStatesReader|runWordsReadable|readerCanOpenWorkflow|workflowsReaderCanOpen|readerCreatedWorkflow)\s*\(/
const ADMIN_ONLY = /\brequireAdmin\b/

type WordsKind = "funnel" | "setting" | "serves" | "admin" | "writes" | "carries" | "internal"
interface Lane<K> { readonly kind: K; readonly why: string }
const lane = <K>(kind: K, why: string): Lane<K> => ({ kind, why })

/**
 * Every file whose code names a failed job's provider words (or the key list
 * that carries them), and what it does with them.
 */
const WORDS: Readonly<Record<string, Lane<WordsKind>>> = {
  "lib/provider-words.ts": lane("funnel", "the funnel: the one decision and the shapes each surface serves the words in"),  "lib/surface-profile.ts": lane("setting", "parses `jobs.errorDetail` and its one reader, surfaceJobErrorDetailReaders"),
  "lib/public-job-data.ts": lane("serves", "maskTrendRunError, which every job read applies, hands each row to jobRowProviderWords first"),
  "routes/jobs.ts": lane("serves", "the job reads (list, by id, both status polls, batch-status) through runJobsProviderWords, then maskTrendRunError(s) / sanitizeJobForPublic; PUBLIC_JOB_KEYS names the column"),
  "lib/webhooks/event.ts": lane("serves", "a job event's body is runJobsProviderWords' row, then sanitizeJobForPublic's non-admin row over PUBLIC_JOB_KEYS; a kept body passes webhookBodyProviderWords with its run's relation"),
  "lib/mcp/tools/_job-view.ts": lane("serves", "the MCP job envelope maps errorDetail through jobRowProviderWords as a non-admin reader, over rows its callers (get_job, wait_for_job) already judged by their run"),
  "lib/mcp/tools/jobs.ts": lane("serves", "list_jobs / get_job / wait_for_job select the column and pass every row through runJobsProviderWords and maskTrendRunError(s); the public scope also judges each row by its owner (jobRowProviderWordsFor)"),
  "lib/mcp/tools/gallery.ts": lane("serves", "get_asset selects the column and passes the row through maskTrendRunError, jobRowProviderWordsFor (it can read another user's public job) and runJobsProviderWords"),
  "lib/mcp/tools/diagnose.ts": lane("serves", "diagnose_run's providerReason (the job's words, else the node state's) goes through maskTrendRunError; on a run through providerWordsShownTo with the reader's relation to the run's workflow, on a job through runJobsProviderWords"),
  "ee/routes/admin-jobs.ts": lane("admin", "the admin one-job and child-jobs reads, behind requireAdmin: admins keep the words"),
  "lib/job-failure.ts": lane("writes", "markJobFailed writes the column a failure's caller hands it"),
  "lib/reconcile/bump-attempts.ts": lane("writes", "writes the redacted reason an exhausted reconcile gives up on"),
  "lib/reconcile/elevenlabs.ts": lane("writes", "writes the provider's failure a reconcile finds"),
  "lib/reconcile/fal.ts": lane("writes", "writes the provider's failure a reconcile finds"),
  "lib/reconcile/house-model.ts": lane("writes", "writes a house model's neutral failure detail a reconcile finds (never the upstream's words)"),
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

/**
 * `serves`: serves a run's states (or what they say) through a reader-aware
 * shape (verified). `fields`: serves only fields it names, never the words
 * (verified: it never names them). `fields-beside-jobs`: its run read serves
 * named fields only, while the same file serves a job's words through the
 * funnel (verified: it calls the funnel). `internal`: never served.
 */
type StatesKind = "serves" | "fields" | "fields-beside-jobs" | "internal"

/**
 * Every file whose code names `node_states` or listens to a run's live events,
 * and what it does with the states.
 */
const NODE_STATES: Readonly<Record<string, Lane<StatesKind>>> = {
  "routes/workflow-execution.ts": lane("serves", "the run reads, the stream's snapshots and live events, and both run lists pass the states through runStatesProviderWords with whether the reader can open the run's workflow"),
  "routes/presentation.ts": lane("serves", "a share link's run status passes node_states through runStatesProviderWords with whether the reader created the workflow; the share page's saved nodes through savedNodesProviderWords"),
  "routes/app-runner.ts": lane("serves", "a published app's runner reads the states through appRunViewStates, which never carries the words"),
  "lib/mcp/tools/diagnose.ts": lane("serves", "lists each node's id, type, status and job only; a failed node's words (providerReason) go through providerWordsShownTo with whether the reader can open the run's workflow"),
  "lib/mcp/tools/gallery.ts": lane("fields-beside-jobs", "get_app_run serves summarizeNodeStates' named fields only; the file's job read (get_asset) serves the words through maskTrendRunError and jobRowProviderWordsFor"),
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

/**
 * The column list a `.select(…)` argument spells: a string, a template (its
 * parts and the same-file consts it interpolates), a same-file const, a `+`
 * of those. Anything else (a call, a parameter) reads as "" — the residual the
 * header states.
 */
function selectText(node: ts.Node | undefined, consts: ReadonlyMap<string, ts.Expression>, depth = 0): string {
  if (!node || depth > 8) return ""
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => selectText(s.expression, consts, depth + 1) + s.literal.text).join("")
  if (ts.isIdentifier(node)) return selectText(consts.get(node.text), consts, depth + 1)
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node)) return selectText(node.expression, consts, depth + 1)
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return selectText(node.left, consts, depth + 1) + selectText(node.right, consts, depth + 1)
  return ""
}

/** Each node's parent, recorded on the way down (the shared parser keeps no parent pointers). */
function parentsOf(root: ts.Node): Map<ts.Node, ts.Node> {
  const parents = new Map<ts.Node, ts.Node>()
  const down = (node: ts.Node): void => {
    node.forEachChild((child) => {
      parents.set(child, node)
      down(child)
    })
  }
  down(root)
  return parents
}

/** Does the chain the call sits in go on to `.eq("user_id", …)` — the read pinned to one owner's rows? */
function pinsTheOwner(call: ts.CallExpression, parents: ReadonlyMap<ts.Node, ts.Node>): boolean {
  let cur: ts.Node = call
  for (;;) {
    const access = parents.get(cur)
    const next = access ? parents.get(access) : undefined
    if (!access || !ts.isPropertyAccessExpression(access) || !next || !ts.isCallExpression(next) || next.expression !== access) return false
    const arg = next.arguments[0]
    if (access.name.text === "eq" && arg && ts.isStringLiteralLike(arg) && arg.text === "user_id") return true
    cur = next
  }
}

/** The same-file consts a column list may name. */
function constsOf(sf: ts.SourceFile): Map<string, ts.Expression> {
  const consts = new Map<string, ts.Expression>()
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) consts.set(n.name.text, n.initializer)
  })
  return consts
}

/** A `jobs` read naming `error_detail` in one file: whether its chain pins the owner, and whether it reads the job's run. */
interface WordRead { readonly pinned: boolean; readonly readsRun: boolean }

/** Every `jobs` read in this file whose column list names `error_detail`. */
function wordReadsOf(sf: ts.SourceFile): WordRead[] {
  const consts = constsOf(sf)
  const parents = parentsOf(sf)
  const reads: WordRead[] = []
  walk(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== "select") return
    if (rootTable(n) !== "jobs") return
    const columns = selectText(n.arguments[0], consts)
    if (!/\berror_detail\b/.test(columns)) return
    reads.push({ pinned: pinsTheOwner(n, parents), readsRun: /\bworkflow_execution_id\b/.test(columns) })
  })
  return reads
}

/** Per file, the `jobs` reads naming `error_detail` matching `pick`. */
function wordReadCounts(pick: (read: WordRead) => boolean): Record<string, number> {
  const counts: Record<string, number> = {}
  eachSourceFile(["error_detail"], (sf, rel) => {
    const n = wordReadsOf(sf).filter(pick).length
    if (n > 0) counts[rel] = n
  })
  return counts
}

/** Per file, the `jobs` reads naming `error_detail` whose own chain does not pin the owner. */
const unpinnedWordReads = (): Record<string, number> => wordReadCounts((read) => !read.pinned)

/**
 * `jobs` reads naming `error_detail` that do NOT read the job's run
 * (`workflow_execution_id`), per file, and why each may serve a run's job
 * without the run rule: `run` — the jobs of one run, read by the ids its node
 * states point at and judged by that run's workflow (verified: the file looks
 * the relation up); `others` — another user's jobs only, which never carry
 * their words (verified: `jobRowProviderWordsFor`); `admin` — an admin-only
 * route (verified: requireAdmin).
 */
const RUN_BLIND_WORD_READS: Readonly<Record<string, { readonly count: number; readonly kind: "run" | "others" | "admin"; readonly why: string }>> = {
  "lib/mcp/tools/diagnose.ts": { count: 1, kind: "run", why: "diagnose_run on a run reads the jobs its failed nodes point at; their words go through providerWordsShownTo with whether the reader can open that run's workflow" },
  "lib/mcp/tools/jobs.ts": { count: 1, kind: "others", why: "list_jobs' public scope reads other users' public jobs only (user_id != caller): each row passes jobRowProviderWordsFor, which withholds every one" },
  "ee/routes/admin-jobs.ts": { count: 1, kind: "admin", why: "the admin one-job read, behind requireAdmin: admins read every job's words" },
}

/**
 * `jobs` reads naming `error_detail` that are not pinned to one owner in their
 * own chain, per file, and why each may return someone else's job:
 * `admin-reader` — pinned for a non-admin in a later statement, any job only for
 * an admin reader (verified: the file tests `isAdmin` and pins `user_id`);
 * `others` — can return another user's job, so each row is judged by its owner
 * (verified: `jobRowProviderWordsFor`); `admin` — an admin-only route
 * (verified: requireAdmin).
 */
const UNPINNED_WORD_READS: Readonly<Record<string, { readonly count: number; readonly kind: "admin-reader" | "others" | "admin"; readonly why: string }>> = {
  "routes/jobs.ts": { count: 4, kind: "admin-reader", why: "GET /v1/jobs/:id, its status poll, the list and batch-status: a non-admin's rows are pinned to them in the next statement (or by the list's owner filter); an admin reads any job" },
  "lib/mcp/tools/jobs.ts": { count: 1, kind: "others", why: "list_jobs' public scope reads other users' public jobs: each row passes jobRowProviderWordsFor before its user_id goes" },
  "lib/mcp/tools/gallery.ts": { count: 1, kind: "others", why: "get_asset reads the caller's job or anyone's public one: the row passes jobRowProviderWordsFor" },
  "ee/routes/admin-jobs.ts": { count: 1, kind: "admin", why: "the admin one-job read, behind requireAdmin" },
}

/** A function's body text, from its declaration to the matching close (comments stripped). */
function bodyOf(code: string, name: string): string {
  const start = code.search(new RegExp(`export (?:async )?function ${name}\\b`))
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
    expect(THROUGH_THE_FUNNEL.test("runStatesProviderWords(states, reader)")).toBe(true)
    expect(THROUGH_THE_FUNNEL.test("jobRowProviderWordsFor(row, { isAdmin: false, userId })")).toBe(true)
    expect(THROUGH_THE_FUNNEL.test("maskTrendRunErrors(rows, false)")).toBe(true)
    expect(THROUGH_THE_FUNNEL.test("import { maskTrendRunError } from")).toBe(false)
    expect(LOOKS_UP_THE_RELATION.test("await readerCanOpenWorkflow(req.userId, row.workflow_id)")).toBe(true)
  })

  it("the select reader resolves the shapes a column list takes, and the owner pin is read off the chain", () => {
    const sf = ts.createSourceFile(
      "probe.ts",
      [
        'const COLS = "id, error_detail"',
        "const MORE = `${COLS}, user_id`",
        'supabase.from("jobs").select(MORE).eq("user_id", me)',
        'supabase.from("jobs").select(`id, status, ${COLS}`).neq("user_id", me)',
        'supabase.from("jobs").select("id, " + COLS).or("user_id.eq.x")',
      ].join("\n"),
      ts.ScriptTarget.Latest,
      false,
    )
    const consts = constsOf(sf)
    const parents = parentsOf(sf)
    const selects: Array<{ text: string; pinned: boolean }> = []
    walk(sf, (n) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "select") selects.push({ text: selectText(n.arguments[0], consts), pinned: pinsTheOwner(n, parents) })
    })
    expect(selects).toEqual([
      { text: "id, error_detail, user_id", pinned: true },
      { text: "id, status, id, error_detail", pinned: false },
      { text: "id, id, error_detail", pinned: false },
    ])
  })

  it("a jobs read of the words that does not read the job's run is told from one that does", () => {
    const sf = ts.createSourceFile(
      "probe.ts",
      [
        'const RUN = "workflow_execution_id"',
        'supabase.from("jobs").select("id, error_detail").eq("user_id", me)',
        'supabase.from("jobs").select(`id, error_detail, ${RUN}`).eq("user_id", me)',
        'supabase.from("jobs").select("id, status").eq("user_id", me)',
        'supabase.from("workflow_executions").select("id, error_detail")',
      ].join("\n"),
      ts.ScriptTarget.Latest,
      false,
    )
    expect(wordReadsOf(sf)).toEqual([
      { pinned: true, readsRun: false },
      { pinned: true, readsRun: true },
    ])
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
    expect(callers, "only lib/provider-words.ts may read the setting: every other place asks providerWordsShownTo").toEqual(["lib/provider-words.ts"])
    const funnel = codeOf("lib/provider-words.ts")
    expect(bodyOf(funnel, "providerWordsShownTo")).toMatch(/surfaceJobErrorDetailReaders\(\)/)
    expect(funnel.match(/surfaceJobErrorDetailReaders\(\)/g), "the setting is read in the one decision only").toHaveLength(1)
    expect(bodyOf(funnel, "providerWordsShown")).toMatch(/providerWordsShownTo\(\{ isAdmin, canRead: true \}\)/)
  }, SCAN_TIMEOUT_MS)

  it("no file but the profile's own reads the key off the profile", () => {
    const readers = shipped().filter((f) => /\.jobs\??\.errorDetail\b/.test(f.code)).map((f) => f.rel)
    expect(readers).toEqual(["lib/surface-profile.ts"])
  }, SCAN_TIMEOUT_MS)

  it("every shape the funnel serves the words in asks the one decision", () => {
    const funnel = codeOf("lib/provider-words.ts")
    for (const shape of ["jobRowProviderWords", "jobRowProviderWordsFor", "jobRowProviderWordsTo", "runStatesProviderWords", "savedNodesProviderWords", "webhookBodyProviderWords"]) {
      expect(bodyOf(funnel, shape), `${shape} does not ask the decision`).toMatch(/providerWordsShown(?:To)?\(/)
    }
    // A job read that can return someone else's job judges the row by its owner.
    expect(bodyOf(funnel, "jobRowProviderWordsFor")).toMatch(/canRead: rec\.user_id === reader\.userId/)
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

  it("a file that serves them goes through a reader-aware shape; one that serves named fields never names the words", () => {
    for (const [rel, l] of Object.entries(NODE_STATES)) {
      const code = codeOf(rel)
      if (l.kind === "serves") expect(RUN_STATES_SHAPE.test(code), `${rel} is marked serves but serves a run's states through no reader-aware shape`).toBe(true)
      if (l.kind === "fields") expect(NAMES_THE_WORDS.test(code), `${rel} is marked fields but names the provider's words: route it through the funnel and mark it serves`).toBe(false)
      if (l.kind === "fields-beside-jobs") expect(THROUGH_THE_FUNNEL.test(code), `${rel} is marked fields-beside-jobs but its job read never calls the funnel`).toBe(true)
    }
  }, SCAN_TIMEOUT_MS)

  it("a file that shows a run's words to a reader who may read them looks that relation up", () => {
    for (const [rel, l] of Object.entries(NODE_STATES)) {
      if (l.kind !== "serves") continue
      const code = codeOf(rel)
      if (!NEEDS_A_RELATION.test(code)) continue
      expect(LOOKS_UP_THE_RELATION.test(code), `${rel} serves a run's states with the words but never asks lib/provider-words-readers.ts who the reader is to the run`).toBe(true)
    }
  }, SCAN_TIMEOUT_MS)

  it("no file outside the funnel tells a shape by hand that the reader may read a run's words", () => {
    const byHand = shipped()
      .filter((f) => f.rel !== "lib/provider-words.ts" && /\b(?:runStatesProviderWords|providerWordsShownTo)\([^)]*canRead:\s*true\b/.test(f.code))
      .map((f) => f.rel)
    expect(byHand, "`canRead: true` passed straight to a run-state shape skips the reader's relation: look it up (lib/provider-words-readers.ts)").toEqual([])
    const jobByHand = shipped()
      .filter((f) => f.rel !== "lib/provider-words.ts" && (/\bjobRowProviderWordsTo\([^)]*canRead:\s*true\b/.test(f.code) || /\bwebhookBodyProviderWords\([^,)]+,\s*true\s*\)/.test(f.code)))
      .map((f) => f.rel)
    expect(jobByHand, "a run's job told by hand that its reader may read its words skips the run's relation: look it up (lib/provider-words-readers.ts)").toEqual([])
  }, SCAN_TIMEOUT_MS)
})

describe("a run's jobs are judged by the run's workflow", () => {
  it("every jobs read of the words reads the job's run, or is counted and classified", () => {
    expect(
      wordReadCounts((read) => !read.readsRun),
      "a jobs read names error_detail but not workflow_execution_id, so a run's job it returns is judged as a job with no run: " +
        "read the run id and pass the rows through runJobsProviderWords (lib/provider-words-readers.ts), or classify it in RUN_BLIND_WORD_READS",
    ).toEqual(Object.fromEntries(Object.entries(RUN_BLIND_WORD_READS).map(([rel, { count }]) => [rel, count])))
    for (const [rel, entry] of Object.entries(RUN_BLIND_WORD_READS)) {
      expect(entry.why.length, `${rel}: say why`).toBeGreaterThan(20)
      const code = codeOf(rel)
      if (entry.kind === "run") expect(LOOKS_UP_THE_RELATION.test(code), `${rel} reads a run's jobs but never asks who the reader is to the run's workflow`).toBe(true)
      if (entry.kind === "others") expect(code, `${rel} serves other users' jobs but never judges a row by its owner`).toMatch(/\bjobRowProviderWordsFor\(/)
      if (entry.kind === "admin") expect(ADMIN_ONLY.test(code), `${rel} is marked admin but has no requireAdmin`).toBe(true)
    }
  }, SCAN_TIMEOUT_MS)

  it("a file that reads the run with the words passes its rows through the run rule", () => {
    const reading = Object.keys(wordReadCounts((read) => read.readsRun)).sort()
    expect(reading.length, "no jobs read reads both the words and the run: the scan is wired to nothing").toBeGreaterThan(3)
    for (const rel of reading) expect(codeOf(rel), `${rel} reads a run's job's words but never applies runJobsProviderWords`).toMatch(/\brunJobsProviderWords\(/)
  }, SCAN_TIMEOUT_MS)

  it("the run rule asks the one decision, looks the relation up only when it can change the answer, and never sends the run id", () => {
    const funnel = codeOf("lib/provider-words.ts")
    const needs = bodyOf(funnel, "jobRowNeedsRunRelation")
    for (const part of [/!isAdmin/, /rec\.error_detail != null/, /runIdOf\(rec\) !== null/, /providerWordsShown\(false\)/]) expect(needs).toMatch(part)
    const readers = codeOf("lib/provider-words-readers.ts")
    const rule = bodyOf(readers, "runJobsProviderWords")
    expect(rule).toMatch(/needing\.length > 0 \? await runsReaderMayRead\(/)
    expect(rule).toMatch(/jobRowProviderWordsTo\(row, \{ isAdmin: reader\.isAdmin, canRead: openable\.has\(runIdOf\(row\)!\) \}\)/)
    expect(rule).toMatch(/const \{ workflow_execution_id: _run, \.\.\.rest \} = judged/)
    // The reader's own runs, read with what the run rule judges them by, then the run rule itself.
    const runs = bodyOf(readers, "runsReaderMayRead")
    expect(runs).toMatch(/\.from\("workflow_executions"\)\s*\.select\(RUN_RELATION_COLUMNS\)\s*\.in\("id", ids\)\s*\.eq\("user_id", readerId\)/)
    expect(runs).toMatch(/return runsWordsReadable\(readerId, runs\)/)
  })
})

describe("a run's states and its jobs are judged by one rule, so they cannot disagree", () => {
  it("the run reads of a run that may name no workflow ask the run rule with the run's row", () => {
    const readers = codeOf("lib/provider-words-readers.ts")
    expect(bodyOf(readers, "runStatesReader")).toMatch(/canRead: await runWordsReadable\(reader\.userId, reader\.run\)/)
    expect(bodyOf(readers, "runWordsReadable")).toMatch(/runsWordsReadable\(readerId, \[run\]\)/)
    const runReads = codeOf("routes/workflow-execution.ts")
    expect(runReads).toMatch(/await runStatesReader\(execution\.node_states, \{ isAdmin, userId: req\.userId, run: execution \}\)/)
    expect(runReads).toMatch(/needsRelation \? runWordsReadable\(req\.userId, execution\) : Promise\.resolve\(true\)/)
    expect(codeOf("lib/mcp/tools/diagnose.ts")).toMatch(/canRead: anyWords \? await runWordsReadable\(session\.userId, execution\) : true/)
  }, SCAN_TIMEOUT_MS)

  it("no run read judges a run by its workflow column alone", () => {
    // A run's `workflow_id` is null on a use-case node's inner run: asking about the column alone
    // withholds the words from its own owner, while its jobs (runJobsProviderWords) read them.
    const byColumn = Object.entries(NODE_STATES)
      .filter(([, l]) => l.kind === "serves")
      .map(([rel]) => rel)
      .filter((rel) => /\b(?:readerCanOpenWorkflow|readerCreatedWorkflow)\([^)]*\.workflow_id\b/.test(codeOf(rel)))
    expect(byColumn, "judge a run that may name no workflow by the run rule (runWordsReadable / runStatesReader with the run's row)").toEqual([])
    // The two run lists judge by the workflow column: the by-workflow list's runs all name its
    // workflow, and the general list never holds a use-case node's inner run.
    expect(codeOf("routes/workflow-execution.ts")).toMatch(/execQuery = execQuery\.neq\("trigger_type", "use_case"\)/)
  }, SCAN_TIMEOUT_MS)
})

describe("the run rule's lookups, and the webhook body", () => {
  it("are looked up once per distinct workflow", () => {
    const readers = codeOf("lib/provider-words-readers.ts")
    expect(bodyOf(readers, "runsWordsReadable")).toMatch(/workflowsReaderCanOpen\(readerId,/)
  })

  it("a job.failed webhook body is judged by its job's run: fresh, on a retry and in the delivery log", () => {
    const event = codeOf("lib/webhooks/event.ts")
    expect(event).toMatch(/\.select\(`\$\{jobEventColumns\(\)\}, workflow_execution_id`\)/)
    expect(event).toMatch(/await runJobsProviderWords\(\[data as unknown as Record<string, unknown>\], \{ isAdmin: false, userId: d\.userId \}\)/)
    expect(event).toMatch(/\.select\(`\$\{CHILD_JOB_COLUMN\}, workflow_execution_id`\)/)
    expect(event).toMatch(/const canRead = await webhookBodyCanRead\(d\.userId, d\.payload, kept\.runId\)/)
    const route = codeOf("routes/webhook-endpoints.ts")
    expect(route.match(/await webhookJobsWithheld\(own\.caller\.userId, /g), "the delivery and the delivery log each judge their kept bodies by their jobs' runs").toHaveLength(2)
    expect(route.match(/toDeliveryResponse\(/g)).toHaveLength(3)
  }, SCAN_TIMEOUT_MS)
})

describe("whose words: a job's are its owner's", () => {
  it("every jobs read naming error_detail that is not pinned to one owner is counted and classified", () => {
    const counts = unpinnedWordReads()
    expect(
      counts,
      "a jobs read names error_detail and can return someone else's job (its chain pins no .eq(\"user_id\", …)): " +
        "judge each row by its owner (jobRowProviderWordsFor) and classify it in UNPINNED_WORD_READS",
    ).toEqual(Object.fromEntries(Object.entries(UNPINNED_WORD_READS).map(([rel, { count }]) => [rel, count])))
    for (const [rel, entry] of Object.entries(UNPINNED_WORD_READS)) expect(entry.why.length, `${rel}: say why`).toBeGreaterThan(20)
  }, SCAN_TIMEOUT_MS)

  it("each classification holds: others judged by owner, an admin reader's read pins a non-admin, an admin route is behind requireAdmin", () => {
    for (const [rel, entry] of Object.entries(UNPINNED_WORD_READS)) {
      const code = codeOf(rel)
      if (entry.kind === "others") expect(code, `${rel} serves other users' jobs but never judges a row by its owner`).toMatch(/\bjobRowProviderWordsFor\(/)
      if (entry.kind === "admin-reader") {
        expect(code, `${rel}: an admin reader's read must test isAdmin`).toMatch(/\bisAdmin\b/)
        expect(code, `${rel}: an admin reader's read must pin a non-admin to their own rows`).toMatch(/\.eq\("user_id",/)
      }
      if (entry.kind === "admin") expect(ADMIN_ONLY.test(code), `${rel} is marked admin but has no requireAdmin`).toBe(true)
    }
  })
})

describe("a share link's reads are the creator's", () => {
  it("the run status keeps a failed node's words for the workflow's creator only, and never sends the run's workflow id", () => {
    const code = codeOf("routes/presentation.ts")
    expect(code).toMatch(/const \{ workflow_id: runWorkflowId, \.\.\.execution \} = read/)
    expect(code).toMatch(/await readerCreatedWorkflow\(req\.userId, runWorkflowId\)/)
    expect(code).toMatch(/node_states: runStatesProviderWords\(execution\.node_states, reader\)/)
  })

  it("the share page's saved nodes keep the words for the creator only", () => {
    expect(codeOf("routes/presentation.ts")).toMatch(/canRead: isOwner \}[\s\S]*nodes: savedNodesProviderWords\(isOwner \? nodes : stripStudioTakeVoiceRecords\(shown\), pageReader\)/)
  })
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
    expect(codeOf("lib/webhooks/event.ts")).toMatch(/body: webhookBodyProviderWords\(d\.payload, canRead\), fresh: false/)
    expect(codeOf("lib/webhooks/endpoints.ts")).toMatch(/requestBody: !hideBody && typeof row\.payload === "string" \? webhookBodyProviderWords\(row\.payload, canRead\) : null/)
  })
})

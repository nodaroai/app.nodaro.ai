/**
 * READ-PATH TOTALITY for canvas result ids (decided 2026-10-05).
 *
 * A saved canvas can hold placeholder `exec-…` job ids and Apply EDL takes
 * with no Preview label. Nothing rewrites the stored rows: every server read
 * that hands workflow nodes to a client or an engine resolves them on the way
 * out (`resolveCanvasResultIds` / `withResolvedResultIds`), and a server save
 * resolves what it writes. A read path added later that skips it would hand
 * out the placeholders again — so every file that selects node content from a
 * table that holds it (`NODE_TABLES`: a workflow's `nodes`, a published app's
 * or a template's `snapshot_nodes`, a history entry's `nodes`) must either call
 * the resolver or be listed below with WHY it is exempt.
 *
 * Keyed by file AND table (`<file>::<table>`): a file that resolves its
 * `workflows` read is still asked about a snapshot table it also reads (the
 * template routes publish from a resolved graph but hand out stored
 * snapshots). Within one (file, table) pair it is file-keyed, like the
 * job-policy totality guard: a second read of the same table added inside a
 * listed file is not re-checked. The two shared loaders resolve for every
 * caller (`loadWorkflowFor`, `loadMcpWorkflow`); a caller may opt out only
 * where listed in `LOADER_OPT_OUTS`.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const SRC = join(__dirname, "..", "..")

/** Every table whose rows carry a canvas's nodes, and the column that holds them. */
const NODE_TABLES: Readonly<Record<string, RegExp>> = {
  workflows: /\bnodes\b|\*/,
  workflow_history: /\bnodes\b|\*/,
  published_apps: /\bsnapshot_nodes\b|\*/,
  workflow_templates: /\bsnapshot_nodes\b|\*/,
}

/** (file, table) reads that go through the resolver. */
const RESOLVES: ReadonlyMap<string, string> = new Map([
  ["lib/workflow-route-access.ts::workflows", "the REST by-id loader: GET /v1/workflows/:id, export, and every route that loads a workflow by id"],
  ["lib/mcp/tools/_workflow-access.ts::workflows", "the MCP by-id loader: get_workflow_json, export_workflow"],
  ["routes/workflows.ts::workflows", "PATCH save and its answer, the move answer, the public share read"],
  ["routes/presentation.ts::workflows", "the shared presentation a viewer opens"],
  ["routes/published-apps.ts::workflows", "publishing: the app snapshot is taken from the resolved graph"],
  ["routes/workflow-templates.ts::workflows", "publishing a template: the snapshot is taken from the resolved graph"],
  ["workers/orchestrator-worker.ts::workflows", "the engine's graph (a skipped render hands its saved take, label included, downstream)"],
  ["services/workflow-engine/sub-workflow-handler.ts::workflows", "the engine's child graph"],
])

/** (file, table) reads that hand no saved result to a client or an engine, or
 *  hand out an immutable snapshot resolved when it was taken. */
const EXEMPT: ReadonlyMap<string, string> = new Map([
  ["ee/copilot/abandoned-sweep.ts::workflows", "only asks whether an abandoned copilot graph is empty"],
  ["ee/copilot/tools/edit-workflow.ts::workflows", "the copilot edits configuration; its graph view drops generated output (EXECUTION_DATA_KEYS) and the write carries results back as stored"],
  ["ee/copilot/tools/get-graph.ts::workflows", "projectData / summarizeData drop generated output (EXECUTION_DATA_KEYS) before the model sees the graph"],
  ["ee/copilot/tools/run-and-execution.ts::workflows", "reads one node's type and config to describe a run proposal"],
  ["ee/routes/copilot.ts::workflows", "the thread's context graph, read through the copilot views that drop generated output"],
  ["ee/pipelines/services/canvas-materializer.ts::workflows", "appends a pipeline node and writes the array back as stored; hands nothing out"],
  ["lib/credential-gate.ts::workflows", "reads credential references only"],
  ["lib/mcp/tools/gallery.ts::workflows", "get_app_run names a run's node states by the workflow's labels and types; what it hands out comes from the execution's node_states, never from saved node results"],
  ["lib/schedule-cron.ts::workflows", "reads Schedule Trigger configuration only"],
  ["lib/preview-fire-refusal.ts::workflows", "reads the graph only to decide whether a fire is refused at a Preview render; hands no node out"],
  ["routes/api-tokens.ts::workflows", "the token API derives a workflow's inputs, outputs and sub-workflow names; run results come from executions, never from saved node results"],
  ["routes/sub-workflows.ts::workflows", "the callable interface (inputs and outputs) only"],
  ["routes/webhook-output.ts::workflows", "reads a Webhook Output's credential only"],
  ["routes/workflow-execution.ts::workflows", "access and run validation; the engine re-reads the graph (orchestrator-worker)"],
  // Published app snapshots: immutable versions, taken from a resolved graph
  // since publishing resolves. Resolving an older snapshot on every open would
  // put a lookup of the creator's jobs on every public app open; republishing
  // the app resolves it.
  ["lib/collect-app-r2-keys.ts::published_apps", "harvests storage keys for deletion; hands nothing out"],
  ["lib/mcp/tools/apps.ts::published_apps", "an immutable published snapshot (resolved when published)"],
  ["routes/app-runner.ts::published_apps", "an immutable published snapshot (resolved when published)"],
  ["routes/component-execute.ts::published_apps", "an immutable published snapshot (resolved when published)"],
  ["routes/og-tags.ts::published_apps", "an immutable published snapshot (resolved when published)"],
  ["routes/published-apps.ts::published_apps", "the catalog's card columns, and the creator's own app rows: immutable published snapshots (resolved when published)"],
  ["workers/orchestrator-worker.ts::published_apps", "an app run's graph is its immutable published snapshot (resolved when published)"],
  // Template snapshots: immutable like app snapshots, and taken from a
  // resolved graph since template publishing resolves (RESOLVES above).
  // GET /v1/templates/mine and /:slug hand them out, and use-template clones
  // them into a workflow owned by the CLONER, whose jobs can never match the
  // creator's. A snapshot published before resolution therefore stays as
  // stored on every clone; resolving it by its creator at clone time is an
  // open product decision, not done here.
  ["routes/workflow-templates.ts::workflow_templates", "immutable template snapshots (resolved when published); handed out and cloned as stored"],
])

/** `resolveResultIds: false` on a shared loader — each one says why. */
const LOADER_OPT_OUTS: ReadonlyMap<string, string> = new Map([
  ["routes/workflows.ts", "PATCH resolves the nodes it writes, and its answer once — one jobs lookup per request, never two; sync-triggers reads trigger configuration and answers counts"],
  ["middleware/sequence-execution-guard.ts", "a preHandler on every canvas single-node POST: judges one node's sequence links and hands nothing out"],
  ["lib/private-plugins/toolkit.ts", "the plugin door hands the row as stored unless the plugin passes resolveResultIds: true (types.ts loadWorkflowFor)"],
])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (name === "__tests__" || name === "node_modules") continue
    if (statSync(path).isDirectory()) walk(path, out)
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) out.push(path)
  }
  return out
}

const rel = (path: string) => relative(SRC, path).split(sep).join("/")

/** Whether one `.from(...)` chain selects node content. A select whose columns
 *  are not a literal (a constant, a variable, a template) counts: it may. */
function selectsNodes(table: string, chain: string): boolean {
  const select = /\.select\(\s*([\s\S]*?)\)/.exec(chain)
  if (!select) return false
  const literal = /^["']([^"']*)["']\s*(,|$)/.exec(select[1].trim())
  if (!literal) return true
  return NODE_TABLES[table].test(literal[1])
}

/** Every `<file>::<table>` pair whose file selects that table's node content. */
function nodeReaders(): Set<string> {
  const readers = new Set<string>()
  const from = new RegExp(`\\.from\\(\\s*["'\`](${Object.keys(NODE_TABLES).join("|")})["'\`]\\s*\\)`, "g")
  for (const file of walk(SRC)) {
    const src = readFileSync(file, "utf8")
    for (const m of src.matchAll(from)) {
      const rest = src.slice((m.index ?? 0) + m[0].length)
      const next = rest.search(/\.from\(/)
      const chain = rest.slice(0, next === -1 ? 1500 : Math.min(next, 1500))
      if (selectsNodes(m[1], chain)) readers.add(`${rel(file)}::${m[1]}`)
    }
  }
  return readers
}

const fileOf = (key: string) => key.split("::")[0]

describe("every server read of workflow nodes resolves canvas result ids", () => {
  const readers = nodeReaders()

  it("finds the reads (a moved source tree must not pass vacuously)", () => {
    expect(readers.size).toBeGreaterThan(20)
    expect(readers.has("lib/workflow-route-access.ts::workflows")).toBe(true)
    // The template routes read both tables, and each pair is judged on its own.
    expect(readers.has("routes/workflow-templates.ts::workflows")).toBe(true)
    expect(readers.has("routes/workflow-templates.ts::workflow_templates")).toBe(true)
  })

  it("no file reads nodes without resolving them or a reason", () => {
    const unaccounted = [...readers].filter((f) => !RESOLVES.has(f) && !EXEMPT.has(f)).sort()
    expect(unaccounted, "call resolveCanvasResultIds / withResolvedResultIds, or add the <file>::<table> pair to EXEMPT with why it hands no saved result to a client or an engine").toEqual([])
  })

  it("every RESOLVES file calls the resolver", () => {
    const missing = [...RESOLVES.keys()].filter((key) => {
      const src = readFileSync(join(SRC, fileOf(key)), "utf8")
      return !/\b(resolveCanvasResultIds|withResolvedResultIds)\(/.test(src)
    })
    expect(missing).toEqual([])
  })

  it("no list entry is stale", () => {
    const stale = [...RESOLVES.keys(), ...EXEMPT.keys()].filter((f) => !readers.has(f))
    expect(stale).toEqual([])
    expect([...RESOLVES.keys()].filter((f) => EXEMPT.has(f))).toEqual([])
  })

  it("a shared loader is opted out only where listed", () => {
    const optOuts = walk(SRC)
      .filter((file) => /resolveResultIds:\s*false/.test(readFileSync(file, "utf8")))
      .map(rel)
      .sort()
    expect(optOuts).toEqual([...LOADER_OPT_OUTS.keys()].sort())
  })
})

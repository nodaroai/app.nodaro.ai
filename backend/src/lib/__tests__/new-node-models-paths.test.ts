// @test-watches backend/src/**/*.ts
/**
 * TOTALITY for "a node the server creates starts on a model the deployment
 * offers" (lib/new-node-models.ts, decided 2026-11-10): every server source
 * that writes a workflow — a `workflows` insert, update or upsert, the
 * id-keyed delta RPC, or the plugin's privileged write — either puts the new
 * nodes it writes through `withOfferedServerNodeModels`, or is listed below
 * with the reason it does not. A new writer fails here until it decides.
 *
 * File-keyed, like the other write guards: a second write added inside a file
 * that already applies the rule is review's to catch.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const SRC = join(__dirname, "..", "..")

/** Writers that put the nodes they create through the rule. */
const APPLIES: Readonly<Record<string, string>> = {
  "lib/mcp/tools/workflows.ts": "MCP create_workflow, update_workflow_json (its new node ids) and import_workflow",
  "ee/copilot/tools/edit-workflow.ts": "Copilot's edit_workflow: the nodes an edit adds",
  "routes/workflow-templates.ts": "template instantiation (Use template → clone)",
  "routes/onboarding.ts": "the starter workflow seeded for a new account",
  "ee/pipelines/services/canvas-materializer.ts": "a pipeline's entity node, built from its defaults",
}

/** Writers that do not, and why. */
const EXEMPT: Readonly<Record<string, string>> = {
  "routes/workflows.ts":
    "the REST API stores the graph its caller sends (create, update, delta, import) — the rule there was not decided on 2026-11-10; a sub-workflow is a copy of saved nodes (a copy keeps its source's models); the other writes move a workflow or name its app",
  "routes/published-apps.ts": "links a workflow to its published app: no node is written",
  "routes/presentation.ts": "writes a workflow's presentation settings: no node is written",
  "ee/routes/copilot.ts": "creates a thread's empty workflow; its nodes come through edit_workflow",
  "ee/copilot/tools/workflow-crud.ts": "creates an empty workflow; its nodes come through edit_workflow, which applies the rule",
  "lib/mcp/flows/conversation-store.ts": "creates an MCP conversation's empty workflow",
  "lib/mcp/flows/history.ts": "records generations an assistant already ran: each node shows the model its job ran on",
  "lib/mcp/flows/workflow-delta.ts": "records an assistant's generation steps (submitted or finished jobs) on its conversation's canvas",
  "lib/tutorial-seed/index.ts": "seeds the platform's own tutorial templates; a user's copy is made by template instantiation, which applies the rule",
  "lib/compatible-workflow-writes.ts": "the Cloud plugin's privileged write of its own documents (Studio productions, Recast), validated by its codec — the plugin builds those nodes",
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules" || entry === "test") continue
      sourceFiles(path, out)
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
      out.push(path)
    }
  }
  return out
}

/** Code without comments (a comment naming a write is not one). */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const WORKFLOW_WRITE = /from\(\s*"workflows"\s*\)\s*\.(?:insert|update|upsert)\(/
const DELTA_RPC = /rpc\(\s*"(?:apply_workflow_delta|create_compatible_workflow|compare_and_swap_compatible_workflow)"/

const writers = sourceFiles(SRC)
  .map((path) => ({ rel: relative(SRC, path).split("\\").join("/"), text: code(readFileSync(path, "utf8")) }))
  .filter((f) => WORKFLOW_WRITE.test(f.text) || DELTA_RPC.test(f.text))

describe("every server path that writes a workflow decides whether its new nodes start on offered models", () => {
  it("found the writers (the scan works)", () => {
    expect(writers.map((f) => f.rel)).toEqual(expect.arrayContaining(["lib/mcp/tools/workflows.ts", "routes/workflow-templates.ts", "ee/copilot/tools/edit-workflow.ts"]))
  })

  it("each writer applies the rule or says why not", () => {
    expect(writers.filter((f) => !APPLIES[f.rel] && !EXEMPT[f.rel]).map((f) => f.rel)).toEqual([])
  })

  it("each writer said to apply it calls withOfferedServerNodeModels", () => {
    const missing = Object.keys(APPLIES).filter((rel) => !writers.find((f) => f.rel === rel)?.text.includes("withOfferedServerNodeModels("))
    expect(missing).toEqual([])
  })

  it("no listed file is stale", () => {
    const found = new Set(writers.map((f) => f.rel))
    expect([...Object.keys(APPLIES), ...Object.keys(EXEMPT)].filter((rel) => !found.has(rel))).toEqual([])
  })
})

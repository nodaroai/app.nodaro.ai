// @test-watches backend/src/**/*.ts
/**
 * TOTALITY for "a stored Seedance reference task type is kept only where the
 * node's model takes it" (decided 2026-11-13): every server source that writes
 * a workflow graph — a `workflows` insert, update or upsert, the id-keyed delta
 * RPC, or the plugin's privileged write — puts the nodes it stores through the
 * one rule (`withListedReferenceTaskTypes`, or `normalizeNodeModelParams`,
 * which runs it), or is listed below with the reason it does not. So do the
 * writes that store a published copy of a graph (an app's or a template's
 * snapshot). A new writer fails here until it decides. The editor's own writes
 * are held by the same census on the frontend.
 *
 * File-keyed, like the other write guards: a second write added inside a file
 * that already applies the rule is review's to catch.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const SRC = join(__dirname, "..", "..")

/** Writers that put the graph they store through the rule. */
const APPLIES: Readonly<Record<string, string>> = {
  "routes/workflows.ts": "REST create (both), PATCH (full body, an edges-only write-back, the delta) and import",
  "routes/workflow-templates.ts": "a template's published snapshot, and the workflow a template clone creates",
  "routes/published-apps.ts": "an app's (or a component's) published snapshot",
  "lib/mcp/tools/workflows.ts": "MCP create_workflow, update_workflow_json and import_workflow (through normalizeNodeModelParams)",
  "ee/copilot/tools/edit-workflow.ts": "Copilot's edit_workflow (through normalizeNodeModelParams)",
  "lib/mcp/flows/workflow-delta.ts": "an assistant's step recorded on its conversation's canvas",
  "lib/mcp/flows/history.ts": "earlier generations filed as a conversation",
  "ee/pipelines/services/canvas-materializer.ts": "a pipeline's entity node placed on the stored graph, written back",
}

/** Writers that do not, and why. */
const EXEMPT: Readonly<Record<string, string>> = {
  "routes/presentation.ts": "writes a workflow's sharing settings: no node is written",
  "ee/routes/copilot.ts": "creates a thread's empty workflow; its nodes come through edit_workflow",
  "ee/copilot/tools/workflow-crud.ts": "creates an empty workflow; its nodes come through edit_workflow",
  "lib/mcp/flows/conversation-store.ts": "creates an MCP conversation's (or a month hub's) empty workflow",
  "routes/onboarding.ts": "seeds the platform's own starter workflow, which stores no task type",
  "lib/tutorial-seed/index.ts": "seeds the platform's own tutorial templates; a user's copy is made by a template clone, which applies the rule",
  "lib/compatible-workflow-writes.ts": "the Cloud plugin's privileged write of its own codec-owned documents (Studio productions, Recast): their write guard refuses any other writer's change",
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
/** A published copy of a graph: the snapshot column an app or a template stores. */
const SNAPSHOT_WRITE = /^\s*snapshot_nodes:[ \t]*(?![ \t]|[A-Z]|unknown\b)/m
const APPLIES_RULE = /\b(?:withListedReferenceTaskTypes|normalizeNodeModelParams)\(/

const files = sourceFiles(SRC).map((path) => ({ rel: relative(SRC, path).split("\\").join("/"), text: code(readFileSync(path, "utf8")) }))
const writers = files.filter((f) => WORKFLOW_WRITE.test(f.text) || DELTA_RPC.test(f.text) || SNAPSHOT_WRITE.test(f.text))

describe("every server path that stores a workflow graph holds its stored reference task types to the node's models", () => {
  it("found the writers (the scan works)", () => {
    expect(writers.map((f) => f.rel)).toEqual(expect.arrayContaining(["routes/workflows.ts", "routes/workflow-templates.ts", "routes/published-apps.ts", "lib/mcp/tools/workflows.ts"]))
  })

  it("each writer applies the rule or says why not", () => {
    expect(writers.filter((f) => !APPLIES[f.rel] && !EXEMPT[f.rel]).map((f) => f.rel)).toEqual([])
  })

  it("each writer said to apply it calls the rule", () => {
    const missing = Object.keys(APPLIES).filter((rel) => !APPLIES_RULE.test(writers.find((f) => f.rel === rel)?.text ?? ""))
    expect(missing).toEqual([])
  })

  it("no listed file is stale", () => {
    const found = new Set(writers.map((f) => f.rel))
    expect([...Object.keys(APPLIES), ...Object.keys(EXEMPT)].filter((rel) => !found.has(rel))).toEqual([])
  })
})

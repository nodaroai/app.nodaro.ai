// @vitest-environment node
// @test-watches frontend/src/**/*.ts frontend/src/**/*.tsx
/**
 * TOTALITY for "a stored Seedance reference task type is kept only where the
 * node's model takes it" (decided 2026-11-13), on the editor's side: every
 * frontend source that writes a workflow graph straight to the database — a
 * `workflows` insert, update or upsert, or the id-keyed delta RPC — puts the
 * nodes it stores through the one rule (`withListedReferenceTaskTypes`,
 * `@nodaro/shared/nodes`), or is listed below with the reason it does not. A new
 * writer fails here until it decides. What the rule stores (only that key goes)
 * is held by its own tests in `@nodaro/shared` and, through the saves, by
 * `use-workflow-persistence-save.test.ts` and `use-projects-store.test.ts`.
 *
 * Besides the file census, each site the hook tests do not reach is pinned to
 * the rule on the node list it writes.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const SRC = join(__dirname, "..", "..")

/** Writers that put the graph they store through the rule. */
const APPLIES: Readonly<Record<string, string>> = {
  "hooks/use-workflow-persistence.ts": "the editor's saves: the delta, the full save (update and a new workflow's insert) and the load's write-back",
  "hooks/use-projects-store.ts": "a copy, a copy into another project and a workflow made from imported content",
  "components/app-runner/mobile-app-shell.tsx": "a remix of an app (mobile)",
  "components/presentation/presentation-view.tsx": "a remix of an app",
  "components/editor/workflow-canvas.tsx": "a graph imported onto the canvas as a new workflow",
}

/** Writers that do not, and why. */
const EXEMPT: Readonly<Record<string, string>> = {
  "hooks/use-create-workflow.ts": "creates an empty workflow: no node is written",
  "hooks/use-workflow-store.ts": "writes a workflow's thumbnail: no node is written",
  "components/dashboard/mcp-conversations/mcp-conversations-view.tsx": "clears a conversation's thumbnail: no node is written",
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules" || entry === "test") continue
      sourceFiles(path, out)
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !entry.endsWith(".d.ts")) {
      out.push(path)
    }
  }
  return out
}

/** Code without comments (a comment naming a write is not one). */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const WORKFLOW_WRITE = /from\(\s*"workflows"\s*\)\s*\.(?:insert|update|upsert)\(/
const DELTA_RPC = /rpc\(\s*"apply_workflow_delta"/
const RULE = "withListedReferenceTaskTypes("

const files = sourceFiles(SRC).map((path) => ({ rel: relative(SRC, path).split("\\").join("/"), text: code(readFileSync(path, "utf8")) }))
const writers = files.filter((f) => WORKFLOW_WRITE.test(f.text) || DELTA_RPC.test(f.text))
const textOf = (rel: string) => files.find((f) => f.rel === rel)!.text

describe("every editor path that stores a workflow graph holds its stored reference task types to the node's models", () => {
  it("found the writers (the scan works)", () => {
    expect(writers.map((f) => f.rel)).toEqual(expect.arrayContaining(["hooks/use-workflow-persistence.ts", "hooks/use-projects-store.ts"]))
  })

  it("each writer applies the rule or says why not", () => {
    expect(writers.filter((f) => !APPLIES[f.rel] && !EXEMPT[f.rel]).map((f) => f.rel)).toEqual([])
  })

  it("each writer said to apply it calls the rule", () => {
    expect(Object.keys(APPLIES).filter((rel) => !textOf(rel).includes(RULE))).toEqual([])
  })

  it("no listed file is stale", () => {
    const found = new Set(writers.map((f) => f.rel))
    expect([...Object.keys(APPLIES), ...Object.keys(EXEMPT)].filter((rel) => !found.has(rel))).toEqual([])
  })

  it("the sites the hook tests do not reach write the rule's node list", () => {
    for (const rel of ["components/app-runner/mobile-app-shell.tsx", "components/presentation/presentation-view.tsx"]) {
      expect(textOf(rel), rel).toContain("nodes: JSON.parse(JSON.stringify(withListedReferenceTaskTypes(appData.snapshotNodes))),")
    }
    expect(textOf("components/editor/workflow-canvas.tsx")).toContain("nodes: JSON.parse(JSON.stringify(withListedReferenceTaskTypes(newNodes))),")
    // The load's write-back of healed nodes.
    expect(textOf("hooks/use-workflow-persistence.ts")).toContain(".update({ nodes: JSON.parse(JSON.stringify(withListedReferenceTaskTypes(stripTransientRuntimeData(orderNodesParentFirst(nodes))))) })")
    // Every delta and full save.
    const persistence = textOf("hooks/use-workflow-persistence.ts")
    expect(persistence).toContain("p_upsert_nodes: JSON.parse(JSON.stringify(withListedReferenceTaskTypes(stripTransientRuntimeData(delta.upsertNodes)))) as never,")
    expect(persistence).toContain("nodes: JSON.parse(JSON.stringify(withListedReferenceTaskTypes(stripTransientRuntimeData(nodes)))),")
  })
})

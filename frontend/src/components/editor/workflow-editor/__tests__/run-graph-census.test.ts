/**
 * The in-browser runner reads the graph as it CARRIES (`runGraph()`): a wire
 * leaving a Teleport Receive is the wire leaving the node feeding its Send, so
 * a Receive passes on exactly what entered the pair (decided 2026-10-13). A runner
 * file that reads the store's raw edges instead judges the Receive by its own
 * type — the bug this closes. This census fails on any raw read of the store's
 * edges in `workflow-editor/` beyond the ones listed here, each with its reason.
 */
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const DIR = join(__dirname, "..")

/** Raw reads of the store's edges, per file, and why each must stay raw. */
const RAW_EDGE_READS: Record<string, { count: number; reason: string }> = {
  "run-graph.ts": { count: 1, reason: "the accessor itself" },
  "list-execution.ts": { count: 1, reason: "expandLoopResults WRITES edges back (clones); a re-pointed wire must never be stored" },
  "execution-graph.ts": { count: 1, reason: "collapseExpandedClones WRITES edges back" },
  "run-handlers.ts": {
    count: 3,
    reason: "scopes a SERVER run (preview stops, balance check): preview-gate walks teleports itself and the estimate's fan-out bypasses them",
  },
  "follow-triggered-run.ts": { count: 1, reason: "follows a server run for display; executes nothing" },
  "workflow-editor-main.tsx": {
    count: 2,
    reason: "the Copilot's single-node gate and price: preview-gate walks teleports itself and the estimate's fan-out bypasses them",
  },
}

/** `const { …edges… } = useWorkflowStore.getState()` or `useWorkflowStore.getState().edges`. */
function rawEdgeReads(source: string): number {
  const destructures = [...source.matchAll(/const \{([^}]*)\} = useWorkflowStore\.getState\(\)/g)].filter((m) =>
    /(^|[\s,])edges\b/.test(m[1]),
  ).length
  const direct = (source.match(/useWorkflowStore\.getState\(\)\.edges\b/g) ?? []).length
  return destructures + direct
}

describe("the in-browser runner reads the graph through runGraph()", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))

  it("finds the runner files", () => {
    expect(files).toContain("execute-node.ts")
    expect(files).toContain("node-input-resolver.ts")
  })

  for (const file of files) {
    it(`${file}: no raw store-edge read outside the reasoned list`, () => {
      const found = rawEdgeReads(readFileSync(join(DIR, file), "utf8"))
      expect(found, RAW_EDGE_READS[file]?.reason ?? "read the graph through runGraph() (run-graph.ts)").toBe(
        RAW_EDGE_READS[file]?.count ?? 0,
      )
    })
  }
})

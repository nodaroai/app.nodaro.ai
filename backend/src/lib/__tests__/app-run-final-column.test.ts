import { describe, it, expect, vi, beforeEach } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

// `app_runs.final_execution_id` (migration 473): an app run's Render final.
// Until the migration reaches the shared database (staging runs dev against
// it, and migrations apply only at dev→main) the column does not exist.

const db = vi.hoisted(() => ({
  updates: [] as Array<{ table: string; row: Record<string, unknown>; filters: Array<[string, unknown]> }>,
  updateErrors: [] as Array<{ code?: string; message: string } | null>,
  selects: [] as Array<{ table: string; columns: string; filters: Array<[string, unknown]> }>,
  selectResult: { data: [] as unknown, error: null as { code?: string; message: string } | null },
  /** Per-select results, in order; `selectResult` once they run out. */
  selectResults: [] as Array<{ data: unknown; error: { code?: string; message: string } | null }>,
}))
vi.mock("../supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      update: (row: Record<string, unknown>) => {
        const filters: Array<[string, unknown]> = []
        const entry = { table, row, filters }
        db.updates.push(entry)
        const chain = {
          eq(column: string, value: unknown) {
            filters.push([column, value])
            return chain
          },
          then(resolve: (v: unknown) => void) {
            resolve({ data: null, error: db.updateErrors.shift() ?? null })
          },
        }
        return chain
      },
      select: (columns: string) => {
        const filters: Array<[string, unknown]> = []
        db.selects.push({ table, columns, filters })
        const chain = {
          in(column: string, value: unknown) {
            filters.push([column, value])
            return chain
          },
          eq(column: string, value: unknown) {
            filters.push([column, value])
            return chain
          },
          maybeSingle() {
            return chain
          },
          then(resolve: (v: unknown) => void) {
            resolve(db.selectResults.shift() ?? db.selectResult)
          },
        }
        return chain
      },
    }),
  },
}))

import {
  finalExecutionColumnAbsent,
  finalExecutionIdOf,
  appRenderFinalStamp,
  appRenderFinalStampOf,
  appRunFinalChain,
  linkAppRunFinal,
  loadAppRunFinals,
  noteFinalExecutionColumnError,
  readAppRunFinals,
  resetFinalExecutionColumnForTests,
  selectWithFinalExecution,
  settleAppRunFinalEdits,
  withFinalExecutionColumn,
} from "../app-run-final-column.js"

beforeEach(() => {
  resetFinalExecutionColumnForTests()
  db.updates.length = 0
  db.updateErrors.length = 0
  db.selects.length = 0
  db.selectResult = { data: [], error: null }
  db.selectResults.length = 0
})

describe("the final_execution_id column guard", () => {
  it("names the column until a missing-column error, then never again", () => {
    expect(withFinalExecutionColumn("id")).toBe("id, final_execution_id")
    expect(noteFinalExecutionColumnError({ code: "42703" })).toBe(true)
    expect(finalExecutionColumnAbsent()).toBe(true)
    expect(withFinalExecutionColumn("id")).toBe("id")
  })

  it("PostgREST's unknown-column code counts too; any other error does not", () => {
    expect(noteFinalExecutionColumnError({ code: "23505" })).toBe(false)
    expect(noteFinalExecutionColumnError(null)).toBe(false)
    expect(finalExecutionColumnAbsent()).toBe(false)
    expect(noteFinalExecutionColumnError({ code: "PGRST204" })).toBe(true)
  })

  it("reads the id off a row, null when none", () => {
    expect(finalExecutionIdOf({ final_execution_id: "e1" })).toBe("e1")
    expect(finalExecutionIdOf({ final_execution_id: null })).toBeNull()
    expect(finalExecutionIdOf({})).toBeNull()
  })

  it("a select retries once without the column", async () => {
    const seen: string[] = []
    const result = await selectWithFinalExecution("id", async (columns) => {
      seen.push(columns)
      return seen.length === 1 ? { data: null, error: { code: "42703", message: "no column" } } : { data: { id: "r" }, error: null }
    })
    expect(seen).toEqual(["id, final_execution_id", "id"])
    expect(result.data).toEqual({ id: "r" })
  })
})

describe("linkAppRunFinal — the run finds its final again", () => {
  it("writes the final's id alone, on the runner's own row — never the run's edits", async () => {
    // The edits stay until the final ENDS (settleAppRunFinalEdits): a final
    // that fails keeps the preview on show, and the runner's edit of it.
    await expect(linkAppRunFinal("run-1", "user-1", "exec-2")).resolves.toBe(true)
    expect(db.updates).toHaveLength(1)
    expect(Object.keys(db.updates[0]!.row)).toEqual(["final_execution_id"])
    expect(db.updates[0]).toEqual({
      table: "app_runs",
      row: { final_execution_id: "exec-2" },
      filters: [
        ["id", "run-1"],
        ["runner_id", "user-1"],
      ],
    })
  })

  it("before the column exists: nothing more is written, the final is not linked", async () => {
    db.updateErrors.push({ code: "PGRST204", message: "no column" })
    await expect(linkAppRunFinal("run-1", "user-1", "exec-2")).resolves.toBe(false)
    expect(db.updates).toHaveLength(1)
    // Known absent: no write at all.
    await expect(linkAppRunFinal("run-1", "user-1", "exec-3")).resolves.toBe(false)
    expect(db.updates).toHaveLength(1)
  })

  it("any other error throws", async () => {
    db.updateErrors.push({ code: "500", message: "boom" })
    await expect(linkAppRunFinal("run-1", "user-1", "exec-2")).rejects.toThrow("boom")
  })
})

describe("settleAppRunFinalEdits — a final that ENDED drops the edits of what it replaced", () => {
  const finalStates = {
    plan: { status: "completed", output: {}, seededFromExecution: "exec-run" },
    cut: { status: "completed", output: { videoUrl: "https://r2/final.mp4", quality: "final" } },
    cap: { status: "failed", error: "boom" },
  }
  const edits = { plan: { editedEdl: { v: 1 } }, cut: { output: { videoUrl: "edited-preview" } }, cap: { output: { text: "x" } } }

  it("drops only the edits of nodes the final completed itself, on the run that links it", async () => {
    db.selectResults.push({ data: { status: "completed", node_states: finalStates }, error: null })
    db.selectResults.push({ data: [{ id: "run-1", node_states: edits }], error: null })
    await settleAppRunFinalEdits("exec-final", "user-1")
    expect(db.selects[0]).toMatchObject({ table: "workflow_executions", filters: [["id", "exec-final"], ["user_id", "user-1"]] })
    expect(db.selects[1]).toMatchObject({ table: "app_runs", filters: [["final_execution_id", "exec-final"], ["runner_id", "user-1"]] })
    expect(db.updates).toEqual([
      {
        table: "app_runs",
        // The seed (plan) and the node the final did not complete (cap) keep their edits.
        row: { node_states: { plan: { editedEdl: { v: 1 } }, cap: { output: { text: "x" } } } },
        filters: [
          ["id", "run-1"],
          ["runner_id", "user-1"],
          ["final_execution_id", "exec-final"],
        ],
      },
    ])
  })

  it("a final still rendering settles nothing", async () => {
    db.selectResults.push({ data: { status: "running", node_states: finalStates }, error: null })
    await settleAppRunFinalEdits("exec-final", "user-1")
    expect(db.selects).toHaveLength(1)
    expect(db.updates).toHaveLength(0)
  })

  // A final that did not complete is never laid over the run (review round 2):
  // the preview stays on show, so the edit of it stays too — even of a node
  // the final completed before something after it failed.
  it("a final that ended without completing keeps every edit, whatever it completed", async () => {
    for (const status of ["failed", "cancelled", "timed_out", "discarded"]) {
      db.selectResults.push({ data: { status, node_states: finalStates }, error: null })
      db.selectResults.push({ data: [{ id: "run-1", node_states: edits }], error: null })
      await settleAppRunFinalEdits("exec-final", "user-1")
      expect(db.updates, status).toHaveLength(0)
      db.selectResults.length = 0
    }
  })

  it("a final whose render failed keeps every edit", async () => {
    db.selectResults.push({ data: { status: "failed", node_states: { cut: { status: "failed" } } }, error: null })
    await settleAppRunFinalEdits("exec-final", "user-1")
    expect(db.updates).toHaveLength(0)
  })

  it("no write when the run holds no edit of a replaced node", async () => {
    db.selectResults.push({ data: { status: "completed", node_states: finalStates }, error: null })
    db.selectResults.push({ data: [{ id: "run-1", node_states: { plan: { editedEdl: {} } } }], error: null })
    await settleAppRunFinalEdits("exec-final", "user-1")
    expect(db.updates).toHaveLength(0)
  })

  it("before the column exists: no read of app_runs at all", async () => {
    noteFinalExecutionColumnError({ code: "42703" })
    await settleAppRunFinalEdits("exec-final", "user-1")
    expect(db.selects).toHaveLength(0)
  })

  it("never throws", async () => {
    db.selectResults.push({ data: { status: "completed", node_states: finalStates }, error: null })
    db.selectResults.push({ data: null, error: { code: "42703", message: "no column" } })
    await expect(settleAppRunFinalEdits("exec-final", "user-1")).resolves.toBeUndefined()
    expect(finalExecutionColumnAbsent()).toBe(true)
  })
})

describe("loadAppRunFinals — only the runner's own executions", () => {
  it("filters by the runner (the service-role read bypasses RLS)", async () => {
    db.selectResult = { data: [{ id: "e1", status: "running", node_states: {}, completed_nodes: 1, total_nodes: 3 }], error: null }
    const finals = await loadAppRunFinals(["e1", "e1", ""], "user-1")
    expect(db.selects[0]!.filters).toEqual([
      ["id", ["e1"]],
      ["user_id", "user-1"],
    ])
    expect(finals.get("e1")).toMatchObject({ id: "e1", status: "running", completedNodes: 1, totalNodes: 3 })
  })

  it("no ids: no read; a failed read: none", async () => {
    expect((await loadAppRunFinals([], "u")).size).toBe(0)
    expect(db.selects).toHaveLength(0)
    db.selectResult = { data: null, error: { message: "down" } }
    expect((await loadAppRunFinals(["e1"], "u")).size).toBe(0)
  })

  // A view degrades to the preview on a failed read; the Render final route
  // must not — it would continue from the run's own execution, re-bill what a
  // final already rendered, and unlink that final (review round 2).
  it("says whether every read succeeded: a failed read is not a final that is not there", async () => {
    expect(await readAppRunFinals([], "u")).toEqual({ finals: new Map(), complete: true })
    db.selectResult = { data: [], error: null }
    expect(await readAppRunFinals(["gone"], "u")).toEqual({ finals: new Map(), complete: true })
    db.selectResult = { data: null, error: { message: "down" } }
    expect((await readAppRunFinals(["e1"], "u")).complete).toBe(false)
  })

  it("a failed read further down the chain is incomplete too", async () => {
    const stamp = appRenderFinalStamp({ appRunId: "run-1", appVersionId: "app-1", continuedFrom: "f1" })
    db.selectResults.push(
      { data: [{ id: "f2", status: "failed", node_states: {}, trigger_data: stamp }], error: null },
      { data: null, error: { message: "down" } },
    )
    const read = await readAppRunFinals(["f2"], "u", ["exec-run"])
    expect(read.complete).toBe(false)
    expect([...read.finals.keys()]).toEqual(["f2"])
  })
})

describe("a chain of finals (decided 2026-10-06): each continues from the run's newest", () => {
  const stamp = (continuedFrom: string) => appRenderFinalStamp({ appRunId: "run-1", appVersionId: "app-1", continuedFrom })

  it("the stamp a final carries, and how it is read back", () => {
    expect(stamp("exec-run")).toEqual({ appRenderFinal: { appRunId: "run-1", appVersionId: "app-1", continuedFrom: "exec-run" } })
    expect(appRenderFinalStampOf(stamp("exec-run"))).toEqual({ appRunId: "run-1", appVersionId: "app-1", continuedFrom: "exec-run" })
    for (const other of [null, {}, { triggerId: "t" }, { appRenderFinal: { appRunId: 1 } }, "x"]) {
      expect(appRenderFinalStampOf(other)).toBeNull()
    }
  })

  it("loads the newest final's earlier finals by their stamps, stopping at the run's own execution", async () => {
    db.selectResults.push(
      { data: [{ id: "f2", status: "pending", node_states: {}, trigger_data: stamp("f1") }], error: null },
      { data: [{ id: "f1", status: "completed", node_states: {}, trigger_data: stamp("exec-run") }], error: null },
    )
    const finals = await loadAppRunFinals(["f2"], "user-1", ["exec-run"])
    expect(db.selects).toHaveLength(2)
    expect(db.selects[1]!.filters).toEqual([
      ["id", ["f1"]],
      ["user_id", "user-1"],
    ])
    expect(finals.get("f2")).toMatchObject({ status: "pending", continuedFrom: "f1" })
    // Oldest first: the order a view lays them over the run.
    expect(appRunFinalChain("f2", finals).map((f) => f.id)).toEqual(["f1", "f2"])
  })

  it("an execution with no stamp is never taken for an earlier final", async () => {
    db.selectResults.push(
      { data: [{ id: "f2", status: "completed", node_states: {}, trigger_data: stamp("x") }], error: null },
      { data: [{ id: "x", status: "completed", node_states: {}, trigger_data: {} }], error: null },
    )
    const finals = await loadAppRunFinals(["f2"], "user-1")
    expect(appRunFinalChain("f2", finals).map((f) => f.id)).toEqual(["f2"])
  })

  it("a cycle in forged stamps ends the walk", async () => {
    db.selectResults.push(
      { data: [{ id: "a", status: "completed", node_states: {}, trigger_data: stamp("b") }], error: null },
      { data: [{ id: "b", status: "completed", node_states: {}, trigger_data: stamp("a") }], error: null },
    )
    const finals = await loadAppRunFinals(["a"], "user-1")
    expect(appRunFinalChain("a", finals).map((f) => f.id)).toEqual(["b", "a"])
  })

  it("no final linked: no chain", () => {
    expect(appRunFinalChain(null, new Map())).toEqual([])
    expect(appRunFinalChain("gone", new Map())).toEqual([])
  })
})

describe("every site that names the column goes through the guard", () => {
  // A statement naming a column the database does not have fails WHOLE, so a
  // site that names it directly breaks the app runner on staging until promotion.
  const SRC = join(__dirname, "..", "..")
  const ALLOWED = new Set(["lib/app-run-final-column.ts"])
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        if (name === "__tests__" || name === "node_modules") continue
        walk(full, out)
      } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
        out.push(full)
      }
    }
    return out
  }
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")

  it("no backend file but the guard module names `final_execution_id` in code", () => {
    const offenders = walk(SRC)
      .map((f) => relative(SRC, f).split("\\").join("/"))
      .filter((rel) => !ALLOWED.has(rel) && code(readFileSync(join(SRC, rel), "utf8")).includes("final_execution_id"))
    expect(offenders).toEqual([])
  })
})

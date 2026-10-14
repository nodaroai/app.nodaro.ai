import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { TIGHTEN_EPISODE_DEFAULTS, buildTightenEpisodeGraph, toStoredInlineGraph } from "@nodaro/render-rules"

const db = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  error: null as { code?: string; message?: string } | null,
  selects: [] as string[],
  filters: [] as string[],
}))
vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => ({
      select: (cols: string) => {
        db.selects.push(cols)
        const chain: Record<string, unknown> = {
          eq: (col: string, v: unknown) => {
            db.filters.push(`${col}=${String(v)}`)
            return chain
          },
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: db.row, error: db.error }),
        }
        return chain
      },
    }),
  },
}))

import {
  INLINE_GRAPH_PROBE_RETRY_MS,
  ensureInlineGraphColumns,
  findExecutionIdForWrapper,
  inlineExecutionColumns,
  inlineGraphCleared,
  inlineGraphColumnAbsent,
  inlineGraphOf,
  loadExecutionForWrapper,
  loadInlineGraph,
  noteInlineGraphColumnError,
  resetInlineGraphColumnForTests,
  withInlineGraphColumns,
  wrapperJobIdOf,
} from "../execution-inline-graph.js"

const SRC = join(__dirname, "..", "..")

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full)
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : []
  })
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("execution-inline-graph column guard (migration 509)", () => {
  beforeEach(() => resetInlineGraphColumnForTests())

  it("names both columns until a missing-column error, then never again", () => {
    expect(withInlineGraphColumns("id, status")).toBe("id, status, inline_graph, wrapper_job_id")
    expect(noteInlineGraphColumnError({ code: "42703", message: 'column workflow_executions.inline_graph does not exist' })).toBe(true)
    expect(inlineGraphColumnAbsent()).toBe(true)
    expect(withInlineGraphColumns("id, status")).toBe("id, status")
  })

  it("counts PGRST204 naming either column, and nothing else", () => {
    expect(noteInlineGraphColumnError({ code: "PGRST204", message: "Could not find the 'wrapper_job_id' column" })).toBe(true)
    resetInlineGraphColumnForTests()
    expect(noteInlineGraphColumnError({ code: "42703", message: "column foo does not exist" })).toBe(false)
    expect(noteInlineGraphColumnError({ code: "23505", message: "inline_graph" })).toBe(false)
    expect(noteInlineGraphColumnError(null)).toBe(false)
    expect(noteInlineGraphColumnError({})).toBe(false)
    expect(inlineGraphColumnAbsent()).toBe(false)
  })

  it("erases the snapshot to an empty object (the graph-source CHECK forbids NULL on an inline row), and drops it while absent", () => {
    expect(inlineGraphCleared()).toEqual({ inline_graph: {} })
    expect(inlineGraphCleared()).not.toBe(inlineGraphCleared())
    noteInlineGraphColumnError({ code: "42703", message: "inline_graph" })
    expect(inlineGraphCleared()).toEqual({})
  })

  it("is the only backend source file that names either column", () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => !f.endsWith(join("lib", "execution-inline-graph.ts")))
      .filter((f) => /\b(inline_graph|wrapper_job_id)\b/.test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => relative(SRC, f))
    expect(offenders).toEqual([])
  })
})

const stored = toStoredInlineGraph(
  buildTightenEpisodeGraph(TIGHTEN_EPISODE_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video" } }),
  TIGHTEN_EPISODE_DEFAULTS,
)

describe("execution-inline-graph readers and writer", () => {
  beforeEach(() => {
    resetInlineGraphColumnForTests()
    db.row = null
    db.error = null
    db.selects.length = 0
    db.filters.length = 0
  })

  it("writes the snapshot and the wrapper pointer", () => {
    expect(inlineExecutionColumns(stored, "job-1")).toEqual({ inline_graph: stored, wrapper_job_id: "job-1" })
  })

  it("reads them back, ignoring anything that is not a stored graph (an expunged row's {} included)", () => {
    expect(inlineGraphOf({ inline_graph: stored })).toEqual(stored)
    expect(inlineGraphOf({ inline_graph: {} })).toBeNull()
    expect(inlineGraphOf(null)).toBeNull()
    expect(wrapperJobIdOf({ wrapper_job_id: "job-1" })).toBe("job-1")
    expect(wrapperJobIdOf({ wrapper_job_id: "" })).toBeNull()
    expect(wrapperJobIdOf({})).toBeNull()
  })

  it("loads a run's snapshot by execution id", async () => {
    db.row = { inline_graph: stored }
    expect(await loadInlineGraph("exec-1")).toEqual(stored)
    expect(db.selects[0]).toBe("inline_graph")
  })

  it("a row with no snapshot, or none at all, reads as null", async () => {
    db.row = { inline_graph: {} }
    expect(await loadInlineGraph("exec-1")).toBeNull()
    db.row = null
    expect(await loadInlineGraph("exec-1")).toBeNull()
  })

  // Decided 2026-10-13: an inline run existing proves the columns exist. A
  // worker that saw them missing before the migration reached the database
  // must not fail every later run until it restarts, so the run's own readers
  // ask whatever the memo says, and a successful read clears it.
  it("a missing column reads as no snapshot and is remembered — but never stops the next load from asking", async () => {
    db.error = { code: "42703", message: "column workflow_executions.inline_graph does not exist" }
    expect(await loadInlineGraph("exec-1")).toBeNull()
    expect(inlineGraphColumnAbsent()).toBe(true)
    db.selects.length = 0
    db.error = null
    db.row = { inline_graph: stored }
    expect(await loadInlineGraph("exec-1")).toEqual(stored)
    expect(db.selects).toEqual(["inline_graph"])
    expect(inlineGraphColumnAbsent()).toBe(false)
    expect(withInlineGraphColumns("id")).toBe("id, inline_graph, wrapper_job_id")
  })
})

describe("execution-inline-graph wrapper readers", () => {
  const row = {
    id: "exec-1", user_id: "u1", status: "completed", node_states: { a: { status: "completed" } },
    total_credits_used: 12, error_message: null, inline_graph: stored, wrapper_job_id: "job-w",
  }
  beforeEach(() => {
    resetInlineGraphColumnForTests()
    db.row = null
    db.error = null
    db.selects.length = 0
    db.filters.length = 0
  })

  it("reads an execution as its wrapper's finaliser sees it", async () => {
    db.row = row
    expect(await loadExecutionForWrapper("exec-1")).toEqual({
      id: "exec-1", userId: "u1", status: "completed", nodeStates: { a: { status: "completed" } },
      totalCreditsUsed: 12, errorMessage: null, wrapperJobId: "job-w", inlineGraph: stored,
    })
    expect(db.selects[0]).toContain("inline_graph, wrapper_job_id")
  })

  it("an erased snapshot reads as no graph, the wrapper pointer kept", async () => {
    db.row = { ...row, inline_graph: {} }
    expect(await loadExecutionForWrapper("exec-1")).toMatchObject({ wrapperJobId: "job-w", inlineGraph: null })
  })

  it("names the columns whatever the memo says, and clears it on success", async () => {
    noteInlineGraphColumnError({ code: "42703", message: "inline_graph" })
    db.row = row
    expect(await loadExecutionForWrapper("exec-1")).not.toBeNull()
    expect(db.selects[0]).toContain("wrapper_job_id")
    expect(inlineGraphColumnAbsent()).toBe(false)
  })

  it("no row → null; a missing column → null and remembered", async () => {
    expect(await loadExecutionForWrapper("exec-1")).toBeNull()
    db.error = { code: "42703", message: "column workflow_executions.wrapper_job_id does not exist" }
    expect(await loadExecutionForWrapper("exec-1")).toBeNull()
    expect(inlineGraphColumnAbsent()).toBe(true)
  })

  it("any other read error throws (never taken for a missing run)", async () => {
    db.error = { code: "57014", message: "statement timeout" }
    await expect(loadExecutionForWrapper("exec-1")).rejects.toThrow(/statement timeout/)
    await expect(findExecutionIdForWrapper("job-w", "u1")).rejects.toThrow(/statement timeout/)
    expect(inlineGraphColumnAbsent()).toBe(false)
  })

  it("finds the run a wrapper names by its pointer, among its owner's runs only", async () => {
    db.row = { id: "exec-9" }
    expect(await findExecutionIdForWrapper("job-w", "u1")).toBe("exec-9")
    expect(db.filters).toEqual(["wrapper_job_id=job-w", "user_id=u1"])
    db.row = null
    expect(await findExecutionIdForWrapper("job-w", "u1")).toBeNull()
  })
})

// A use-case route asks before it writes its wrapper or holds its fee: the
// memo above learns only from a failed write, which would come too late.
describe("ensureInlineGraphColumns (the eager probe a use-case route asks first)", () => {
  let clock = 1_000_000
  const now = () => clock
  beforeEach(() => {
    resetInlineGraphColumnForTests()
    clock = 1_000_000
    db.row = null
    db.error = null
    db.selects.length = 0
  })

  it("present: true, asks both columns once, then never again for the process", async () => {
    expect(await ensureInlineGraphColumns(now)).toBe(true)
    expect(db.selects).toEqual(["inline_graph, wrapper_job_id"])
    db.error = { code: "42703", message: "column workflow_executions.inline_graph does not exist" }
    expect(await ensureInlineGraphColumns(now)).toBe(true)
    expect(db.selects).toHaveLength(1)
  })

  it("present clears a memo an earlier failed write left behind (the run start would otherwise refuse after the hold)", async () => {
    noteInlineGraphColumnError({ code: "42703", message: "inline_graph" })
    expect(await ensureInlineGraphColumns(now)).toBe(true)
    expect(inlineGraphColumnAbsent()).toBe(false)
  })

  it("missing: false and remembered for the retry window, then asked again — the migration landing is noticed without a restart", async () => {
    db.error = { code: "42703", message: "column workflow_executions.inline_graph does not exist" }
    expect(await ensureInlineGraphColumns(now)).toBe(false)
    expect(inlineGraphColumnAbsent()).toBe(true)
    db.error = null
    clock += INLINE_GRAPH_PROBE_RETRY_MS - 1
    expect(await ensureInlineGraphColumns(now)).toBe(false)
    expect(db.selects).toHaveLength(1)
    clock += 1
    expect(await ensureInlineGraphColumns(now)).toBe(true)
    expect(db.selects).toHaveLength(2)
    expect(inlineGraphColumnAbsent()).toBe(false)
  })

  it("any other error is no answer: nothing cached, the route goes on", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    db.error = { code: "57014", message: "statement timeout" }
    expect(await ensureInlineGraphColumns(now)).toBe(true)
    expect(inlineGraphColumnAbsent()).toBe(false)
    db.error = { code: "42703", message: "column workflow_executions.wrapper_job_id does not exist" }
    expect(await ensureInlineGraphColumns(now)).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
